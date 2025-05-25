const TokenEngine = require("../engine/token");
const { WhaleEngine } = require("../engine/whale");
const Site = require("../env");
const Log = require("../lib/log");

let TelegramEngine = null;
let SocketEngine = null;

/**
 * Filters good tokens that have graduated from observer to be sent to token engine.
 */
class GraduateEngine {

    /**
     * Holds concatenated name and symbol of past tokens to prevent duplicates.
     * @type {string[]}
     */
    static #duplicateHistory = [];

    /**
     * Counts total number of tokens that graduated
     * @type {number}
     */
    static graduated = 0;

    /**
     * Counts total number of tokens that could not graduate
     * @type {number}
     */
    static notGraduated = 0;

    /**
     * If true, tokens can be sent to the token engine
     * @type {boolean}
     */
    static acceptToken = Site.AUTO_ACCEPT_TOKEN;

    /**
     * Called from observer engine when a token has graduated.
     * @param {any} data
     */
    static entry = async (data) => {
        const { name, mint, symbol, description, developer, uri, raw_audit_data, human_audit_data, price_history } = data;
        const r = raw_audit_data || {};
        Log.flow(`Graduate > ${name} (${symbol}) > Graduated.`, 4);
        const notDuplicate = Site.GR_USE_DUPLICATE_TOKEN_FILTER ? GraduateEngine.#duplicateHistory.indexOf(`${name}${symbol}`) < 0 : true;
        if (Site.GR_USE_DUPLICATE_TOKEN_FILTER) {
            GraduateEngine.#duplicateHistory.push(`${name}${symbol}`);
            if (GraduateEngine.#duplicateHistory.length > Site.GR_DUPLICATE_TOKEN_FILTER_MEM_LENGTH) {
                GraduateEngine.#duplicateHistory = GraduateEngine.#duplicateHistory.slice(GraduateEngine.#duplicateHistory.length - Site.GR_DUPLICATE_TOKEN_FILTER_MEM_LENGTH);
            }
        }
        if (notDuplicate) {
            let failReason = "";
            if (!failReason && (Site.GR_AUDIT_DEV_OT_REQUIRED ? (r.dev_other_tokens ? (r.dev_other_tokens_pass_perc < Site.GR_AUDIT_DEV_OT_MIN_PERC) : true) : false)) {
                failReason = `Dev's other tokens only passed ${(r.dev_other_tokens_pass_perc || 0).toFixed(2)}%`;
            }
            if (!failReason && (Site.GR_AUDIT_DEV_CAN_SELL ? (r.dev_sold_some ? (r.dev_sold_perc > Site.GR_AUDIT_DEV_MAX_SELL_PERC) : false) : r.dev_sold_some)) {
                failReason = `Dev Sold ${(r.dev_sold_perc || 0).toFixed(2)}%`;
            }
            if (!failReason && (r.dev_hold_perc > Site.GR_AUDIT_DEV_MAX_HOLD_PERC)) {
                failReason = `Dev is holding ${(r.dev_hold_perc || 0).toFixed(2)}%`;
            }
            if (!failReason && (r.replies_count < Site.GR_AUDIT_REPLIES_MIN)) {
                failReason = `Not enough replies (${r.replies_count} / ${Site.GR_AUDIT_REPLIES_MIN})`;
            }
            if (!failReason && (r.replies_unique_repliers_perc < Site.GR_AUDIT_REPLIES_REPLIERS_MIN_PERC)) {
                failReason = `Not enough unique repliers (${(r.replies_unique_repliers_perc || 0).toFixed(2)}% / ${Site.GR_AUDIT_REPLIES_REPLIERS_MIN_PERC}%)`;
            }
            if (!failReason && (r.replies_unique_score < Site.GR_AUDIT_REPLIES_UNIQUE_SCORE_MIN)) {
                failReason = `Not enough unique replies score (${(r.replies_unique_score || 0).toFixed(2)} / ${Site.GR_AUDIT_REPLIES_UNIQUE_SCORE_MIN})`;
            }
            if (!failReason && (r.holders_count < Site.GR_AUDIT_HOLDERS_RANGE.MIN || r.holders_count > Site.GR_AUDIT_HOLDERS_RANGE.MAX)) {
                failReason = `Holders count (${r.holders_count}) out of range (${Site.GR_AUDIT_HOLDERS_RANGE.MIN} - ${Site.GR_AUDIT_HOLDERS_RANGE.MAX})`;
            }
            if (!failReason && (r.holders_top_perc > Site.GR_AUDIT_HOLDERS_TOP_MAX_PERC)) {
                failReason = `Top holders holding (${(r.holders_top_perc || 0).toFixed(2)}) more than allowed (${Site.GR_AUDIT_HOLDERS_TOP_MAX_PERC}%)`;
            }
            if (!failReason && (r.holders_sus_score > Site.GR_AUDIT_HOLDERS_SUSSCORE_MAX)) {
                failReason = `Holders' sus score (${(r.holders_sus_score || 0).toFixed(2)}) more than allowed (${Site.GR_AUDIT_HOLDERS_SUSSCORE_MAX})`;
            }
            if (!failReason && (Site.GR_AUDIT_SOCIAL_TELEGRAM_REQ && (!r.social_telegram))) {
                failReason = `Telegram is required`;
            }
            if (!failReason && (Site.GR_AUDIT_SOCIAL_TWITTER_REQ && (!r.social_twitter))) {
                failReason = `Twitter is required`;
            }
            if (!failReason && (Site.GR_AUDIT_SOCIAL_WEBSITE_REQ && (!r.social_website))) {
                failReason = `Website is required`;
            }
            if (!failReason && (r.trades < Site.GR_AUDIT_TRADES_RANGE.MIN || r.trades > Site.GR_AUDIT_TRADES_RANGE.MAX)) {
                failReason = `Trades (${r.trades}) out of range (${Site.GR_AUDIT_TRADES_RANGE.MIN} - ${Site.GR_AUDIT_TRADES_RANGE.MAX})`;
            }
            if (!failReason && (r.buy_perc < Site.GR_AUDIT_BUY_PERC_RANGE.MIN || r.buy_perc > Site.GR_AUDIT_BUY_PERC_RANGE.MAX)) {
                failReason = `Buys (${(r.buy_perc || 0).toFixed(2)}%) out of range (${Site.GR_AUDIT_BUY_PERC_RANGE.MIN}% - ${Site.GR_AUDIT_BUY_PERC_RANGE.MAX}%)`;
            }
            if (!failReason && (r.buy_vol_perc < Site.GR_AUDIT_BUY_VOL_PERC_RANGE.MIN || r.buy_vol_perc > Site.GR_AUDIT_BUY_VOL_PERC_RANGE.MAX)) {
                failReason = `Buy Volume (${(r.buy_vol_perc || 0).toFixed(2)}%) out of range (${Site.GR_AUDIT_BUY_VOL_PERC_RANGE.MIN}% - ${Site.GR_AUDIT_BUY_VOL_PERC_RANGE.MAX}%)`;
            }

            let min = 0;
            if (r.social_telegram) min++;
            if (r.social_twitter) min++;
            if (r.social_website) min++;

            if (!failReason && (min < Site.GR_AUDIT_SOCIAL_MIN)) {
                failReason = `Min ${Site.GR_AUDIT_SOCIAL_MIN} social link(s) is required`;
            }

            if (!TelegramEngine) {
                TelegramEngine = require("../engine/telegram");
            }

            if (failReason) {
                Log.flow(`Graduate > ${name} (${symbol}) > Audit Failed > ${failReason}.`, 4);
                GraduateEngine.notGraduated++;
                if (Site.TG_SEND_AUDIT_FAILED) {
                    let msg = `🚫 Audit Failed\n\n${name} \\(${symbol}\\)\n\n\`\`\`\nReason: ${failReason}\n${Object.keys(human_audit_data).map(key => `${key}: ${human_audit_data[key]}`).join("\n")}\`\`\``;
                    TelegramEngine.sendMessage(msg);
                    if (Site.UI && msg) {
                        if (!SocketEngine) {
                            SocketEngine = require("../engine/socket");
                        }
                        SocketEngine.sendNote(msg);
                    }
                }
            }
            else {
                Log.flow(`Graduate > ${name} (${symbol}) > Audit Passed.`, 4);
                GraduateEngine.graduated++;
                if (GraduateEngine.acceptToken) {
                    if (!TokenEngine.getToken(mint)) {
                        const registered = await TokenEngine.registerToken(mint, "Kiko");
                        if (registered) {
                            WhaleEngine.newToken(mint, raw_audit_data.top_holders);
                            const audit = human_audit_data || {};
                            const logMode = `\n\`\`\`\n${Object.keys(audit).map(key => `${key}: ${audit[key]}`).join("\n")}\`\`\``;
                            const token = TokenEngine.getToken(mint);
                            token.price_history = structuredClone(price_history);
                            let msg = `✅ ${token.name} \\(${token.symbol}\\) is now being monitored${token.description ? `\n\n\`\`\`\n${token.description}\`\`\`` : ''}\n\n*Audit*${logMode}\n\n\`${mint}\``;
                            TelegramEngine.sendMessage(msg);
                            if (Site.UI && msg) {
                                if (!SocketEngine) {
                                    SocketEngine = require("../engine/socket");
                                }
                                SocketEngine.sendNote(msg);
                            }
                            token.description = "";
                        }
                    }
                }
            }

            if (Site.UI) {
                if (!SocketEngine) {
                    SocketEngine = require("../engine/socket");
                }
                SocketEngine.sendKiko(null, {
                    graduatedTokens: GraduateEngine.graduated,
                    blockedTokens: GraduateEngine.notGraduated,
                }, false);
            }
        }
        else {
            Log.flow(`Graduate > ${name} (${symbol}) > Error > Duplicate token.`, 4);
        }

    }

}

module.exports = GraduateEngine;