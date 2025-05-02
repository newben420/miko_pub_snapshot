const Site = require("../env");
const FFF = require("../lib/fff");
const formatNumber = require("../lib/format_number");
const getTimeElapsed = require("../lib/get_time_elapsed");
const Log = require("../lib/log");
const TelegramBot = require('node-telegram-bot-api');

let TokenEngine = null;

let TelegramEngine = null;

let SolPrice = null;

class SignalManager {

    static activeBuy = false;
    static latestMid = 0;

    /**
     * @type {Record<string, boolean>}
     */
    static acitveSell = {};

    /**
     * @type {Record<string, number>}
     */
    static acitveSellMID = {};

    /**
     * @type {boolean}
     */
    static buyAlert = Site.BUY_ALERT; 

    /**
     * @type {boolean}
     */
    static sellAlert = Site.SELL_ALERT; 

    /**
     * Signals are passed here from candlestick class.
     * @param {string} mint 
     * @param {boolean} buy 
     * @param {boolean} sell 
     * @param {string} desc 
     * @param {number} vol 
     * @param {number} tpsl 
     */
    static entry = async (mint, buy, sell, desc, vol, tpsl) => {
        if (!TokenEngine) {
            TokenEngine = require("./token");
        }
        if (!TelegramEngine) {
            TelegramEngine = require("./telegram");
        }
        if (!SolPrice) {
            SolPrice = require("./sol_price");
        }
        if (!TokenEngine || !TelegramEngine) {
            return;
        }
        let token = TokenEngine.getToken(mint);
        if (token) {
            token.rec_buy = buy;
            token.rec_sell = sell;
            Log.flow(`Signal > ${buy ? "Buy" : "Sell"} received for '${token.name}' with desc '${desc}'`, 1);
            let entry = buy || (sell && desc.includes("BULL"));
            if (entry) {
                // BUY SIGNAL
                if ((!SignalManager.activeBuy) && SignalManager.buyAlert) {
                    SignalManager.activeBuy = true;
                    let m = `‼️ *BUY* $${token.symbol}\n\n`;
                    m += `💲 *${token.name}*\n`;
                    m += `🚨 *${desc}*\n`;
                    m += `R ⏱️ *${getTimeElapsed(token.reg_timestamp, Date.now())}*\n`;
                    m += `*Vol* ${vol.toFixed(2)}% *TSL* ${tpsl.toFixed(2)}% \n\n`
                    m += `P 💰 ${Site.BASE} ${FFF(token.current_price)}\n`;
                    m += `MM P 💰 ${Site.BASE} ${FFF(token.least_price)} => ${FFF(token.peak_price)} \\(${formatNumber((((token.peak_price - token.least_price) / token.least_price * 100) || 0).toFixed(2))}%\\)\n`;
                    m += `MC 📈 ${Site.BASE} ${FFF(token.current_marketcap)} \\(USD ${FFF(token.current_marketcap * SolPrice.get())}\\)\n `;
                    m += `MM MC 📈 ${Site.BASE} ${FFF(token.min_marketcap)} => ${FFF(token.max_marketcap)} \\(USD ${FFF(token.min_marketcap * SolPrice.get())} => ${FFF(token.max_marketcap * SolPrice.get())}\\)\n`;
                    m += `C Amt 💰 ${token.symbol} *${FFF(token.amount_held)}* \\(${Site.BASE} ${FFF(token.amount_held * token.current_price)} | USD ${FFF(token.amount_held * token.current_price * SolPrice.get())}\\)\n`;
                    const PnL = ((token.total_sold_base + (token.current_price * token.amount_held)) - token.total_bought_base);
                    const pnlPerc = (((PnL / token.total_bought_base) * 100) || 0).toFixed(2);
                    m += `PnL 💰 ${Site.BASE} ${FFF(PnL)} \\(USD ${FFF(PnL * SolPrice.get())} | ${pnlPerc}%\\)\n`;
                    if (Site.COL_MULTIPLES_MS_ARR.length > 0 && token.price_history.length > 0) {
                        for (let j = 0; j < Site.COL_MULTIPLES_MS_ARR.length; j++) {
                            const interv = Site.COL_MULTIPLES_MS_ARR[j];
                            const div = Math.ceil(interv / Site.COL_DURATION_MS);
                            const l = token.price_history.length;
                            const firstIndex = token.price_history.length - 1;
                            const finalIndex = Math.max(0, l - div);
                            const from = token.price_history[firstIndex].close;
                            const to = token.price_history[finalIndex].close;
                            const diff = (from - to) / to * 100;
                            m += `🔸 ${getTimeElapsed(0, (0 + interv))}: ${(diff || 0).toFixed(2)}%\n`;
                        }
                    }
                    /**
                     * @type {TelegramBot.InlineKeyboardButton[][]}
                     */
                    let amts = [[]];

                    let available = Site.DE_BUY_AMOUNTS_SOL.map(x => x);
                    const columnLength = 3;
                    let col = 0;
                    while (available.length > 0) {
                        let amt = available.shift();
                        amts[amts.length - 1].push(
                            {
                                text: `${Site.BASE} ${amt}`,
                                callback_data: `buy_${`${amt}`.replace(".", "-")}_${mint}`,
                            }
                        );
                        col++;
                        if (col >= columnLength) {
                            amts.push([]);
                            col = 0;
                        }
                    }

                    if ((amts[amts.length - 1] || []).length != 0) {
                        amts.push([]);
                    }
                    amts[amts.length - 1].push(
                        {
                            text: `❌ Cancel`,
                            callback_data: `cancel_buy`,
                        }
                    );

                    /**
                     * @type {TelegramBot.SendMessageOptions}
                     */
                    const opts = {
                        parse_mode: "MarkdownV2",
                        reply_markup: {
                            inline_keyboard: amts,
                        }
                    };
                    TelegramEngine.sendMessage(m, mid => {
                        if (mid) {
                            SignalManager.latestMid = mid;
                            setTimeout(async () => {
                                if (SignalManager.activeBuy && SignalManager.latestMid) {
                                    const deleted = await TelegramEngine.deleteMessage(SignalManager.latestMid);
                                    if (deleted) {
                                        SignalManager.activeBuy = false;
                                    }
                                }
                            }, Site.TG_MESSAGE_DURATION_MS);
                        }
                        else {
                            SignalManager.activeBuy = false;
                        }
                    }, opts, true);
                }
            }
            else {
                // SELL SIGNAL
                if (token.amount_held > 0 && SignalManager.sellAlert) {
                    // if (true) {
                    if (SignalManager.acitveSell[mint] && SignalManager.acitveSellMID[mint]) {
                        const deleted = await TelegramEngine.deleteMessage(SignalManager.acitveSellMID[mint]);
                        if (deleted) {
                            delete SignalManager.acitveSell[mint];
                            delete SignalManager.acitveSellMID[mint];
                        }
                    }
                    SignalManager.acitveSell[mint] = true;
                    let m = `‼️ *SELL* $${token.symbol}\n\n`;
                    m += `💲 *${token.name}*\n`;
                    m += `🚨 *${desc}*\n`;
                    m += `R ⏱️ *${getTimeElapsed(token.reg_timestamp, Date.now())}*\n`;
                    m += `*Vol* ${vol.toFixed(2)}% *TSL* ${tpsl.toFixed(2)}% \n\n`
                    m += `P 💰 ${Site.BASE} ${FFF(token.current_price)}\n`;
                    m += `MM P 💰 ${Site.BASE} ${FFF(token.least_price)} => ${FFF(token.peak_price)} \\(${formatNumber((((token.peak_price - token.least_price) / token.least_price * 100) || 0).toFixed(2))}%\\)\n`;
                    m += `MC 📈 ${Site.BASE} ${FFF(token.current_marketcap)} \\(USD ${FFF(token.current_marketcap * SolPrice.get())}\\)\n `;
                    m += `MM MC 📈 ${Site.BASE} ${FFF(token.min_marketcap)} => ${FFF(token.max_marketcap)} \\(USD ${FFF(token.min_marketcap * SolPrice.get())} => ${FFF(token.max_marketcap * SolPrice.get())}\\)\n`;
                    m += `C Amt 💰 ${token.symbol} *${FFF(token.amount_held)}* \\(${Site.BASE} ${FFF(token.amount_held * token.current_price)} | USD ${FFF(token.amount_held * token.current_price * SolPrice.get())}\\)\n`;
                    const PnL = ((token.total_sold_base + (token.current_price * token.amount_held)) - token.total_bought_base);
                    const pnlPerc = (((PnL / token.total_bought_base) * 100) || 0).toFixed(2);
                    m += `PnL 💰 ${Site.BASE} ${FFF(PnL)} \\(USD ${FFF(PnL * SolPrice.get())} | ${pnlPerc}%\\)\n`;
                    if (Site.COL_MULTIPLES_MS_ARR.length > 0 && token.price_history.length > 0) {
                        for (let j = 0; j < Site.COL_MULTIPLES_MS_ARR.length; j++) {
                            const interv = Site.COL_MULTIPLES_MS_ARR[j];
                            const div = Math.ceil(interv / Site.COL_DURATION_MS);
                            const l = token.price_history.length;
                            const firstIndex = token.price_history.length - 1;
                            const finalIndex = Math.max(0, l - div);
                            const from = token.price_history[firstIndex].close;
                            const to = token.price_history[finalIndex].close;
                            const diff = (from - to) / to * 100;
                            m += `🔸 ${getTimeElapsed(0, (0 + interv))}: ${(diff || 0).toFixed(2)}%\n`;
                        }
                    }
                    /**
                     * @type {TelegramBot.InlineKeyboardButton[][]}
                     */
                    let amts = [[]];

                    let available = Site.DE_SELL_PERCS_SOL.map(x => x);
                    const columnLength = 3;
                    let col = 0;
                    while (available.length > 0) {
                        let amt = available.shift();
                        amts[amts.length - 1].push(
                            {
                                text: `${amt}%`,
                                callback_data: `sell_${`${amt}`.replace(".", "-")}_${mint}`,
                            }
                        );
                        col++;
                        if (col >= columnLength) {
                            amts.push([]);
                            col = 0;
                        }
                    }

                    if ((amts[amts.length - 1] || []).length != 0) {
                        amts.push([]);
                    }
                    amts[amts.length - 1].push(
                        {
                            text: `❌ Cancel`,
                            callback_data: `cancel_sell_${mint}`,
                        }
                    );

                    /**
                     * @type {TelegramBot.SendMessageOptions}
                     */
                    const opts = {
                        parse_mode: "MarkdownV2",
                        reply_markup: {
                            inline_keyboard: amts,
                        },
                    };
                    TelegramEngine.sendMessage(m, mid => {
                        if (mid) {
                            SignalManager.acitveSellMID[mint] = mid;
                            setTimeout(async () => {
                                if (SignalManager.acitveSell[mint] && SignalManager.acitveSellMID[mint]) {
                                    const deleted = await TelegramEngine.deleteMessage(SignalManager.acitveSellMID[mint]);
                                    if (deleted) {
                                        delete SignalManager.acitveSell[mint];
                                        delete SignalManager.acitveSellMID[mint];
                                    }

                                }
                            }, Site.TG_MESSAGE_DURATION_MS);
                        }
                        else {
                            SignalManager.acitveSell[mint] = false;
                        }
                    }, opts, true);
                }
            }
        }

    }
}

module.exports = SignalManager;