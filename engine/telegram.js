const TelegramBot = require('node-telegram-bot-api');
const { Connection, PublicKey } = require("@solana/web3.js");
const Site = require('../env');
const Log = require('../lib/log');
const FFF = require('../lib/fff');
const formatNumber = require('../lib/format_number');
const TokenEngine = require('./token');
const SolPrice = require('./sol_price');
const getTimeElapsed = require('../lib/get_time_elapsed');
const { LimitOrder } = require('./token_model');
const Regex = require('../lib/regex');
const getDateTime = require('../lib/get_date_time');
const ObserverEngine = require('../kiko/observer');
const GraduateEngine = require('../kiko/graduate');
const { WhaleEngine } = require('./whale');

let SignalManager = null;

class TelegramEngine {

    /**
     * @type {TelegramBot}
     */
    static #bot;

    static processWebHook = (body) => {
        if (!Site.POLLING) {
            try {
                TelegramEngine.#bot.processUpdate(body);
            } catch (error) {
                Log.dev(error);
            }

        }
    }

    /**
     * Holds temporary limit order
     * @type {LimitOrder|null}
     */
    static #limit = null;

    /**
     * Holds last message ID for limit order creation
     * @type {any}
     */
    static #limitLastMID = 0;

    /**
     * Holds the mint of the token the order is being created for
     * @type {string}
     */
    static #limitMint = "";

    /**
     * @type {Record<string, string>}
     */
    static #blacklist = {}

    static #previousTokensMessage = "";

    static #getObserveContent = () => {
        let message = `🔭 *Observer* - ${getDateTime()}\n\nCurrent Tokens 💲 ${formatNumber(Object.keys(ObserverEngine.tokens).length)}\nAll Tokens 💲 ${formatNumber(ObserverEngine.observed)}\nGraduated Tokens 💲 ${formatNumber(GraduateEngine.graduated)}\nBlocked Tokens 💲 ${formatNumber(GraduateEngine.notGraduated)}\n\n*✅ Audited*\n\n`;

        let auditedTokens = Object.keys(ObserverEngine.tokens).map(x => ObserverEngine.tokens[x]).filter(x => x.audited);

        if (auditedTokens.length > 0) {
            for (const token of auditedTokens) {
                message += `🚀 ${token.name} \\(${token.symbol}\\)\n`;
                message += `⏱️ Registered ${getTimeElapsed(token.reg_timestamp, Date.now())} ago\n`;
                message += `📝 Audited ${formatNumber(token.number_of_audits)} time${token.number_of_audits == 1 ? "" : "s"} ${getTimeElapsed(token.audit_timestamp, Date.now())} ago\n`;
                message += `📈 Bonded ${token.bonding_progress.toFixed(2)}%\n`;
                message += `📍\`${token.mint}\`\n\n`;
            }
        }
        else {
            message += `❌ No audited token at the moment`
        }
        /**
         * @type {TelegramBot.InlineKeyboardButton[][]}
         */
        let inline = [
            [
                {
                    text: `♻️ Refresh`,
                    callback_data: `reloadobserve`
                }
            ]
        ];

        return { message, inline };
    }

    static #getTokensContent = () => {
        /**
         * @type {string}
         */
        let message = '';
        /**
         * @type {TelegramBot.InlineKeyboardButton[][]}
         */
        let inline = [];
        const mints = TokenEngine.getTokensMint().map(x => TokenEngine.getToken(x)).filter(x => x).sort((a, b) => {
            const aAbove = a.amount_held > 0;
            const bAbove = b.amount_held > 0;
            if (aAbove === bAbove) return 0;
            return aAbove ? 1 : -1;
        }).map(x => x.mint);
        if (mints.length > 0) {
            let ax = [];
            /**
             * @type {TelegramBot.InlineKeyboardButton[][]}
             */
            let inn = [];
            let limitOrdersLength = [];
            let index = 1;
            for (let i = 0; i < mints.length; i++) {
                if (TelegramEngine.#blacklist[mints[i]]) {
                    continue;
                }
                limitOrdersLength.push(1);
                let m = "";
                const token = TokenEngine.getToken(mints[i]);
                if (token.pending_orders.length > 0) {
                    for (let j = 0; j < token.pending_orders.length; j++) {
                        limitOrdersLength[limitOrdersLength.length - 1]++;
                        const order = token.pending_orders[j];
                        inn.push([{
                            text: `${order.trailing ? '🧲' : '🎯'} ${order.type.toUpperCase()} ${order.type == "buy" ? Site.BASE : ""} ${order.amount}${order.type == "sell" ? "%" : ""}  (MC ${((order.type == "buy" && order.marketcap > 0) || (order.type == "sell" && order.marketcap < 0)) ? '<=' : '>='} ${Site.BASE_DENOMINATED ? Site.BASE : "USD"} ${FFF(Math.abs(order.marketcap))}) ❌`,
                            callback_data: `delorder_${token.mint}_${j}`,
                        }]);
                    }
                }
                inn.push([]);
                let kb = inn[inn.length - 1];
                m += `${index}. *${token.name}*\n`;
                m += `‼️ ${token.rec_buy ? "B" : "DNB"} ‼️ ${token.rec_sell ? "S" : "DNS"}\n`;
                m += `R ⏱️ *${getTimeElapsed(token.reg_timestamp, Date.now())}*\n`;
                m += `LU ⏱️ *${getTimeElapsed(token.last_updated, Date.now())}*\n`;
                m += `P 💰 ${Site.BASE} ${FFF(token.current_price)}\n`;
                m += `MM P 💰 ${Site.BASE} ${FFF(token.least_price)} => ${FFF(token.peak_price)} \\(${formatNumber((((token.peak_price - token.least_price) / token.least_price * 100) || 0).toFixed(2))}%\\)\n`;
                m += `MC 📈 ${Site.BASE} ${FFF(token.current_marketcap)} \\(USD ${FFF(token.current_marketcap * SolPrice.get())}\\)\n`;
                m += `MM MC 📈 ${Site.BASE} ${FFF(token.min_marketcap)} => ${FFF(token.max_marketcap)} \\(USD ${FFF(token.min_marketcap * SolPrice.get())} => ${FFF(token.max_marketcap * SolPrice.get())}\\)\n`;
                m += `Amt 💰 ${token.symbol} *${FFF(token.amount_held)}* \\(${Site.BASE} ${FFF(token.amount_held * token.current_price)} | USD ${FFF(token.amount_held * token.current_price * SolPrice.get())}\\)\n`;
                if (token.entry_reasons.size > 0) {
                    m += `Entry Reasons 🔵 ${Array.from(token.entry_reasons).map(r => `\`${r}\``).join(" | ")}\n`;
                }
                if (token.exit_reasons.size > 0) {
                    m += `Exit Reasons 🟠 ${Array.from(token.exit_reasons).map(r => `\`${r}\``).join(" | ")}\n`;
                }
                m += `PnL 💰 ${Site.BASE} ${FFF(token.pnl_base)} \\(USD ${FFF(token.pnl_base * SolPrice.get())} | *${token.pnl.toFixed(2)}%*\\)\n`;
                if (token.pnl || token.min_pnl || token.max_pnl) {
                    m += `MM PnL 💰 ${token.min_pnl.toFixed(2)}% => ${token.max_pnl.toFixed(2)}% \n`;
                }
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
                m += `Mint 📍 \`${token.mint}\`\n`;
                if (token.current_price > 0) {
                    kb.push({
                        text: `🟢 ${index}`,
                        callback_data: `buynow_${token.mint}`
                    });
                }
                if (token.amount_held > 0 && token.current_price > 0) {
                    kb.push({
                        text: `🔴 ${index}`,
                        callback_data: `sellnow_${token.mint}`
                    });
                }
                kb.push({
                    text: `❌ ${index}`,
                    callback_data: `remove_${token.mint}`
                });
                if (token.amount_held != 0 && token.current_price > 0) {
                    kb.push({
                        text: `🔄 ${index}`,
                        callback_data: `reset_${token.mint}`
                    });
                }
                kb.push({
                    text: `🚫 ${index}`,
                    callback_data: `blacklist_${token.mint}`
                });
                kb.push({
                    text: `🎯 ${index}`,
                    callback_data: `limit_start_${token.mint}`
                });

                m += `\n`;
                // if (i < (mints.length - 1)) {
                //     m += `----\n\n`;
                // }
                ax.push(m);
                index++;
            }
            let cutoffIndex = 0;
            let totalLength = 0;
            const maxLength = 4000;
            for (let i = ax.length - 1; i >= 0; i--) {
                totalLength += ax[i].length;
                cutoffIndex = i;
                if (totalLength > maxLength) {
                    break;
                }
            }
            ax = ax.slice(cutoffIndex);
            let innCutoffIndex = 0;
            for (let i = 0; i < cutoffIndex; i++) {
                innCutoffIndex += limitOrdersLength[i];
            }
            inn = inn.slice(innCutoffIndex);
            inn.reverse();
            inn = [[{
                text: `♻️ Update Tokens`,
                callback_data: `reloadtokens`
            }]].concat(inn);
            let m = `🔑 *Tokens* - ${getDateTime()}\n\n${cutoffIndex > 0 ? `*\\[${cutoffIndex} hidden\\]*\n\n` : ''}${ax.join("")}`;
            if (ax.length > 0) {
                return { m, inn };
            }
            return {
                m: `🔑 *Tokens* - ${getDateTime()}\n\n❌ No tokens are being monitored currently`, inn: [
                    [{
                        text: `♻️ Update Tokens`,
                        callback_data: `reloadtokens`
                    }]
                ]
            };
        }
        else {
            return {
                m: `🔑 *Tokens* - ${getDateTime()}\n\n❌ No tokens are being monitored currently`, inn: [
                    [{
                        text: `♻️ Update Tokens`,
                        callback_data: `reloadtokens`
                    }]
                ]
            };
        }
    }

    static #getAutoContent = () => {
        if (!SignalManager) {
            SignalManager = require("./signal_manager");
        }

        let message = `🤖 *Automation Interface*\n\n⏱️ ${getDateTime()}\n\n`;

        message += `${Site.SIMULATION ? `🟢` : `🔴`} Simulation\n`;
        message += `${TokenEngine.autoBuy ? `🟢` : `🔴`} Auto Buy\n`;
        message += `${TokenEngine.autoSell ? `🟢` : `🔴`} Auto Sell\n`;
        message += `${TokenEngine.autoPD ? `🟢` : `🔴`} Peak Drop\n`;
        message += `${GraduateEngine.acceptToken ? `🟢` : `🔴`} Accept Token\n`;
        message += `${SignalManager.buyAlert ? `🟢` : `🔴`} Buy Alert\n`;
        message += `${SignalManager.sellAlert ? `🟢` : `🔴`} Sell Alert\n`;
        message += `${WhaleEngine.useEntry ? `🟢` : `🔴`} Whale Entry\n`;
        message += `${WhaleEngine.useExit ? `🟢` : `🔴`} Whale Exit\n`;

        /**
         * @type {TelegramBot.InlineKeyboardButton[][]}
         */
        let inline = [
            [
                {
                    text: `${Site.SIMULATION ? `🔴` : `🟢`} Simulation`,
                    callback_data: `auto_sm_${Site.SIMULATION ? `false` : `true`}`,
                },
            ],
            [
                {
                    text: `${TokenEngine.autoBuy ? `🔴` : `🟢`} Auto Buy`,
                    callback_data: `auto_buy_${TokenEngine.autoBuy ? `false` : `true`}`,
                },
                {
                    text: `${TokenEngine.autoSell ? `🔴` : `🟢`} Auto Sell`,
                    callback_data: `auto_sell_${TokenEngine.autoSell ? `false` : `true`}`,
                }
            ],
            [
                {
                    text: `${TokenEngine.autoPD ? `🔴` : `🟢`} Peak Drop`,
                    callback_data: `auto_pd_${TokenEngine.autoPD ? `false` : `true`}`,
                },
                {
                    text: `${GraduateEngine.acceptToken ? `🔴` : `🟢`} Accept Token`,
                    callback_data: `auto_at_${GraduateEngine.acceptToken ? `false` : `true`}`,
                }
            ],
            [
                {
                    text: `${SignalManager.buyAlert ? `🔴` : `🟢`} Buy Alert`,
                    callback_data: `auto_ba_${SignalManager.buyAlert ? `false` : `true`}`,
                },
                {
                    text: `${SignalManager.sellAlert ? `🔴` : `🟢`} Sell Alert`,
                    callback_data: `auto_sa_${SignalManager.sellAlert ? `false` : `true`}`,
                },
            ],
            [
                {
                    text: `${WhaleEngine.useEntry ? `🔴` : `🟢`} Whale Entry`,
                    callback_data: `auto_wen_${WhaleEngine.useEntry ? `false` : `true`}`,
                },
                {
                    text: `${WhaleEngine.useExit ? `🔴` : `🟢`} Whale Exit`,
                    callback_data: `auto_wex_${WhaleEngine.useExit ? `false` : `true`}`,
                },
            ]
        ];

        return { message, inline };
    }

    static #lastobservecontent = "";

    static init = () => {
        return new Promise((resolve, reject) => {
            TelegramEngine.#bot = new TelegramBot(Site.TG_TOKEN, {
                polling: Site.TG_POLLING,
                request: {
                    agentOptions: {
                        family: Site.FORCE_FAMILY_4 ? 4 : undefined,
                    }
                }
            });
            TelegramEngine.#bot.setMyCommands([
                {
                    command: "/tokens",
                    description: "Manage tokens"
                },
                {
                    command: "/wallet",
                    description: "Show wallet balance and address"
                },
                {
                    command: "/recover",
                    description: "Close empty token accounts and register non-empty token accounts"
                },
                {
                    command: "/blacklist",
                    description: "Blacklist"
                },
                {
                    command: "/auto",
                    description: "Automation"
                },
                {
                    command: "/observe",
                    description: "Observer"
                },
                {
                    command: "/start",
                    description: "👋"
                }
            ]);
            if (!Site.TG_POLLING) {
                TelegramEngine.#bot.setWebHook(`${Site.URL}/webhook`, {
                    secret_token: Site.TG_WH_SECRET_TOKEN,
                });
            }
            TelegramEngine.#bot.on("text", async (msg) => {
                let content = (msg.text || "").trim();
                const pid = msg.chat.id || msg.from.id;
                if (pid && pid == Site.TG_CHAT_ID) {
                    if (/^\/start$/.test(content)) {
                        let rPnL = (Site.SIMULATION ? TokenEngine.realizedPnLSimulation : TokenEngine.realizedPnLLive).reduce((a, b) => a +b, 0);
                        let nPnL = rPnL - (Site.SIMULATION ? 0 : (TokenEngine.successfulTx * 0.000005))
                        TelegramEngine.sendMessage(`*${Site.TITLE}* says hi 👋\n\n*Realised PnL* 💰 ${Site.BASE} ${FFF(rPnL)} \\(USD ${FFF(rPnL * SolPrice.get())}\\)\n*Net PnL* 💰 ${Site.BASE} ${FFF(nPnL)} \\(USD ${FFF(nPnL * SolPrice.get())}\\)`);
                    }
                    else if (/^\/observe$/.test(content)) {
                        const { message, inline } = TelegramEngine.#getObserveContent();
                        try {
                            if (message && message != TelegramEngine.#lastobservecontent) {
                                TelegramEngine.#lastobservecontent = message;
                                TelegramEngine.sendMessage(message, mid => { }, {
                                    disable_web_page_preview: true,
                                    parse_mode: "MarkdownV2",
                                    reply_markup: {
                                        inline_keyboard: inline,
                                    }
                                });
                            }
                        } catch (error) {
                            Log.dev(error);
                        }
                    }
                    else if (/^\/tokens$/.test(content)) {
                        const { m, inn } = TelegramEngine.#getTokensContent();
                        try {
                            if (TelegramEngine.#lastTokenMessageID && TelegramEngine.#lastTokenMessageID == TelegramEngine.#lastMessageID) {
                                // repeat message
                                if (m && m != TelegramEngine.#previousTokensMessage) {
                                    TelegramEngine.#previousTokensMessage = m;
                                    const done = await TelegramEngine.#bot.editMessageText(TelegramEngine.sanitizeMessage(m), {
                                        chat_id: Site.TG_CHAT_ID,
                                        message_id: TelegramEngine.#lastTokenMessageID,
                                        parse_mode: "MarkdownV2",
                                        disable_web_page_preview: true,
                                        reply_markup: {
                                            inline_keyboard: inn,
                                        }
                                    });
                                    if (done) {
                                        TelegramEngine.deleteMessage(msg.message_id);
                                    }
                                }
                                else {
                                    TelegramEngine.deleteMessage(msg.message_id);
                                }
                            }
                            else {
                                TelegramEngine.sendMessage(m, mid => {
                                    if (mid) {
                                        TelegramEngine.#lastTokenMessageID = mid;
                                        TelegramEngine.#previousTokensMessage = m;
                                    }
                                }, {
                                    parse_mode: "MarkdownV2",
                                    disable_web_page_preview: true,
                                    reply_markup: {
                                        inline_keyboard: inn,
                                    }
                                });
                            }
                        } catch (error) {
                            Log.dev(error);
                        }
                    }
                    else if (/^\/wallet$/.test(content)) {
                        const balance = await TokenEngine.getBalance();
                        if (balance || balance === 0) {
                            TelegramEngine.sendMessage(`🏦 *Account*\n\n📍 \`${Site.DE_LOCAL_PUB_KEY}\`\n\n💰 ${Site.BASE} \`${balance}\``);
                        }
                    }
                    else if (/^\/auto$/.test(content)) {
                        const { message, inline } = TelegramEngine.#getAutoContent();
                        TelegramEngine.sendMessage(message, mid => { }, {
                            disable_web_page_preview: true,
                            parse_mode: "MarkdownV2",
                            reply_markup: {
                                inline_keyboard: inline,
                            }
                        });
                    }
                    else if (/^\/blacklist$/.test(content)) {
                        let m = `🚫 *Blacklist*\n\n_Click on any to remove_`;
                        const mints = Object.keys(TelegramEngine.#blacklist);
                        /**
                         * @type {TelegramBot.InlineKeyboardButton[][]}
                         */
                        let inn = [];
                        if (mints.length > 0) {
                            for (let i = 0; i < mints.length; i++) {
                                const mint = mints[i];
                                const token = TokenEngine.getToken(mint);
                                if (token) {
                                    inn.push([{
                                        text: `${token.name} (${token.symbol})`,
                                        callback_data: `rejoin_${token.mint}`,
                                    }])
                                }
                                else {
                                    delete TelegramEngine.#blacklist[mint];
                                    i--;
                                }
                            }
                            if (inn.length > 0) {
                                TelegramEngine.sendMessage(m, mid => { }, {
                                    parse_mode: "MarkdownV2",
                                    reply_markup: {
                                        inline_keyboard: inn,
                                    }
                                });
                            }
                            else {
                                TelegramEngine.sendMessage(`❌ No tokens are blacklisted`);
                            }
                        }
                        else {
                            TelegramEngine.sendMessage(`❌ No tokens are blacklisted`);
                        }
                    }
                    else if (/^\/recover$/.test(content)) {
                        const recovered = await TokenEngine.recovery();
                        if (recovered) {
                            TelegramEngine.sendMessage(`✅ Recovery successful`);
                        }
                        else {
                            TelegramEngine.sendMessage(`❌ Recovery failed`);
                        }
                    }
                    else if ((msg.reply_to_message || {}).message_id == TelegramEngine.#limitLastMID && TelegramEngine.#limit && TelegramEngine.#limitLastMID && TelegramEngine.#limitMint) {
                        let mc = parseFloat(content) || 0;
                        TelegramEngine.#limit.marketcap = mc;
                        const registered = await TokenEngine.registerLimitOrder(TelegramEngine.#limitMint, structuredClone(TelegramEngine.#limit));
                        if (registered) {
                            TelegramEngine.deleteMessage(TelegramEngine.#limitLastMID);
                            TelegramEngine.#limitLastMID = 0;
                            TelegramEngine.#limitMint = "";
                            TelegramEngine.#limit = null;
                            TelegramEngine.sendMessage(`✅ Limit order registered`);
                        }
                        else {
                            TelegramEngine.sendMessage(`❌ Could not register limit order`);
                        }
                    }
                    else if (Regex.mint.test(content)) {
                        if (TokenEngine.getTokensMint().indexOf(content) >= 0) {
                            TelegramEngine.sendMessage(`❌ Token already being monitored`);
                        }
                        else {
                            const registered = await TokenEngine.registerToken(content);
                            if (registered) {
                                const token = TokenEngine.getToken(content);
                                TelegramEngine.sendMessage(`✅ ${token.name} \\(${token.symbol}\\) is now being monitored${token.description ? `\n\n\`\`\`\n${token.description}\`\`\`` : ''}`);
                                token.description = "";
                            }
                            else {
                                TelegramEngine.sendMessage(`❌ An error was encountered while adding token`);
                            }
                        }
                    }
                    else {
                        // content = content.replace(/^\/start/, "").replace(/\-/g, ".").trim().replace(/_/g, " ");
                    }
                }
            });

            // TelegramEngine.#bot.on("", async (msg) => {

            // });

            TelegramEngine.#bot.on("callback_query", async (callbackQuery) => {
                const pid = callbackQuery.message.chat.id || callbackQuery.message.from.id;
                if (pid && pid == Site.TG_CHAT_ID) {
                    if (callbackQuery.data == "cancel_buy") {
                        try {
                            TelegramEngine.#bot.answerCallbackQuery(callbackQuery.id);
                            if (!SignalManager) {
                                SignalManager = require("./signal_manager");
                            }
                            if (SignalManager.activeBuy && SignalManager.latestMid) {
                                const deleted = await TelegramEngine.deleteMessage(SignalManager.latestMid);
                                if (deleted) {
                                    SignalManager.activeBuy = false;
                                }
                            }
                        } catch (error) {

                        }
                    }
                    else if (callbackQuery.data.startsWith("cancel_sell_")) {
                        const mint = callbackQuery.data.replace("cancel_sell_", "").trim();
                        try {
                            TelegramEngine.#bot.answerCallbackQuery(callbackQuery.id);
                            if (!SignalManager) {
                                SignalManager = require("./signal_manager");
                            }
                            if (SignalManager.acitveSell[mint] && SignalManager.acitveSellMID[mint]) {
                                const deleted = await TelegramEngine.deleteMessage(SignalManager.acitveSellMID[mint]);
                                if (deleted) {
                                    delete SignalManager.acitveSell[mint];
                                    delete SignalManager.acitveSellMID[mint];
                                }
                            }
                        } catch (error) {

                        }
                    }
                    else if (callbackQuery.data == "cancel_limit" && TelegramEngine.#limit && TelegramEngine.#limitLastMID && TelegramEngine.#limitMint) {
                        TelegramEngine.deleteMessage(TelegramEngine.#limitLastMID);
                        TelegramEngine.#bot.answerCallbackQuery(callbackQuery.id);
                        TelegramEngine.#limit = null;
                        TelegramEngine.#limitMint = "";
                    }
                    else if (callbackQuery.data.startsWith("limit_type_") && TelegramEngine.#limit && TelegramEngine.#limitLastMID && TelegramEngine.#limitMint) {
                        const orderType = callbackQuery.data.replace("limit_type_", "").toLowerCase();
                        TelegramEngine.#bot.answerCallbackQuery(callbackQuery.id);
                        TelegramEngine.deleteMessage(TelegramEngine.#limitLastMID);
                        TelegramEngine.#limit.type = orderType;
                        /**
                         * @type {TelegramBot.InlineKeyboardButton[][]}
                         */
                        let amts = [[]];
                        let m = "";
                        const columnLength = 3;
                        let col = 0;
                        /**
                         * @type {number[]}
                         */
                        let available;
                        if (TelegramEngine.#limit.type == "buy") {
                            m = `Choose buy amount`;
                            available = Site.DE_BUY_AMOUNTS_SOL.map(x => x);
                        }
                        else {
                            m = `Choose sell percentage`;
                            available = Site.DE_SELL_PERCS_SOL.map(x => x);
                        }
                        while (available.length > 0) {
                            let amt = available.shift();
                            amts[amts.length - 1].push(
                                {
                                    text: `${orderType == "buy" ? Site.BASE : ""} ${amt}${orderType == "sell" ? "%" : ""}`,
                                    callback_data: `limit_amt_${amt}`,
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
                                callback_data: `cancel_limit`,
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
                                TelegramEngine.#limitLastMID = mid;
                            }
                        }, opts);
                    }
                    else if (callbackQuery.data.startsWith("limit_amt_") && TelegramEngine.#limit && TelegramEngine.#limitLastMID && TelegramEngine.#limitMint) {
                        const orderAmt = parseFloat(callbackQuery.data.replace("limit_amt_", ""));
                        TelegramEngine.#bot.answerCallbackQuery(callbackQuery.id);
                        TelegramEngine.deleteMessage(TelegramEngine.#limitLastMID);
                        TelegramEngine.#limit.amount = orderAmt;

                        const m = `Enter MC limit in ${Site.BASE_DENOMINATED ? Site.BASE : "USD"}${TelegramEngine.#limit.type == "sell" ? "\nUse a signed negative number for stop loss" : ""}\n\n↪ _Reply to this message with it_`;
                        TelegramEngine.sendMessage(m, mid => {
                            if (mid) {
                                TelegramEngine.#limitLastMID = mid;
                            }
                        }, {
                            parse_mode: "MarkdownV2",
                            reply_markup: {
                                force_reply: true,
                            }
                        })
                    }
                    else {
                        let content = callbackQuery.data || "";
                        content = content.replace(/\-/g, ".").trim().replace(/_/g, " ").trim();
                        if (content.startsWith("auto ")) {
                            let temp1 = content.split(" ");
                            const newValue = temp1[2] == "true";
                            const variable = temp1[1];
                            if (!SignalManager) {
                                SignalManager = require("./signal_manager");
                            }
                            if (variable == "buy") {
                                TokenEngine.autoBuy = newValue;
                            }
                            else if (variable == "sell") {
                                TokenEngine.autoSell = newValue;
                            }
                            else if (variable == "pd") {
                                TokenEngine.autoPD = newValue;
                            }
                            else if (variable == "at") {
                                GraduateEngine.acceptToken = newValue;
                            }
                            else if (variable == "ba") {
                                SignalManager.buyAlert = newValue;
                            }
                            else if (variable == "sa") {
                                SignalManager.sellAlert = newValue;
                            }
                            else if (variable == "sm") {
                                Site.SIMULATION = newValue;
                            }
                            else if (variable == "wen") {
                                WhaleEngine.useEntry = newValue;
                            }
                            else if (variable == "wex") {
                                WhaleEngine.useExit = newValue;
                            }
                            TelegramEngine.#bot.answerCallbackQuery(callbackQuery.id);
                            const { message, inline } = TelegramEngine.#getAutoContent();
                            try {
                                TelegramEngine.#bot.editMessageText(TelegramEngine.sanitizeMessage(message), {
                                    chat_id: Site.TG_CHAT_ID,
                                    message_id: callbackQuery.message.message_id,
                                    parse_mode: "MarkdownV2",
                                    disable_web_page_preview: true,
                                    reply_markup: {
                                        inline_keyboard: inline,
                                    }
                                });
                            } catch (error) {
                                Log.dev(error);
                            }
                        }
                        else if (content.startsWith("buy ")) {
                            let temp1 = content.split(" ");
                            let amt = parseFloat(temp1[1]);
                            let mint = temp1[2];
                            try {
                                TelegramEngine.#bot.answerCallbackQuery(callbackQuery.id);
                                TelegramEngine.deleteMessage(callbackQuery.message.message_id);
                                if (!SignalManager) {
                                    SignalManager = require("./signal_manager");
                                }
                                if (SignalManager.activeBuy && SignalManager.latestMid) {
                                    SignalManager.activeBuy = false;
                                }
                                const bought = await TokenEngine.buy(mint, amt, "Manual");
                                if (bought) {
                                    if (Site.SIMULATION) {
                                        const token = TokenEngine.getToken(mint) || {};
                                        TelegramEngine.sendMessage(`✅ *BUY*\n\nSwapped ${Site.BASE} ${FFF(amt)} \\(USD ${FFF(amt * SolPrice.get())}\\) to ${token.symbol} ${FFF(bought)}\n\nMC 📈 ${Site.BASE} ${FFF(token.current_marketcap)} \\(USD ${FFF(token.current_marketcap * SolPrice.get())}\\)\nPrice 💰 ${Site.BASE} ${FFF(token.current_price)}\n`);
                                    }
                                    else {
                                        TelegramEngine.sendMessage(`✅ *BUY*\n\nBuy operation completed \\(${Site.BASE} ${amt}\\)\n\n🪧 \`${bought}\``);
                                    }
                                }
                                else {
                                    TelegramEngine.sendMessage(`❌ Could not complete buy operation`);
                                }
                            } catch (error) {
                                Log.dev(error);
                            }
                        }
                        else if (content.startsWith("sell ")) {
                            let temp1 = content.split(" ");
                            let perc = parseFloat(temp1[1]);
                            let mint = temp1[2];
                            try {
                                TelegramEngine.#bot.answerCallbackQuery(callbackQuery.id);
                                TelegramEngine.deleteMessage(callbackQuery.message.message_id);
                                if (!SignalManager) {
                                    SignalManager = require("./signal_manager");
                                }
                                if (SignalManager.acitveSell[mint] && SignalManager.acitveSellMID[mint]) {
                                    delete SignalManager.acitveSell[mint];
                                    delete SignalManager.acitveSellMID[mint];
                                }
                                const token = TokenEngine.getToken(mint) || {};
                                const allocation = ((token || {}).amount_held || 0) + 0;
                                const sold = await TokenEngine.sell(mint, perc, "Manual");
                                if (sold) {
                                    if (Site.SIMULATION) {
                                        TelegramEngine.sendMessage(`✅ *SELL*\n\nSwapped ${token.symbol} ${FFF(((perc / 100) * allocation) || 0)} \\(${perc}%\\) to ${Site.BASE} ${FFF(sold)} \\(USD ${FFF(sold * SolPrice.get())}\\)\n\nMC 📈 ${Site.BASE} ${FFF(token.current_marketcap)} \\(USD ${FFF(token.current_marketcap * SolPrice.get())}\\)\nPrice 💰 ${Site.BASE} ${FFF(token.current_price)}\n`);
                                    }
                                    else {
                                        TelegramEngine.sendMessage(`✅ *SELL*\n\nSell operation completed \\(${perc}%\\)\n\n🪧 \`${sold}\``);
                                    }

                                }
                                else {
                                    TelegramEngine.sendMessage(`❌ Could not complete sell operation`)
                                }
                            } catch (error) {
                                Log.dev(error);
                            }
                        }
                        else if (content.startsWith("remove ")) {
                            let temp1 = content.split(" ");
                            let mint = temp1[1];
                            TelegramEngine.#bot.answerCallbackQuery(callbackQuery.id);
                            const done = await TokenEngine.removeToken(mint);
                        }
                        else if (content.startsWith("reset ")) {
                            let temp1 = content.split(" ");
                            let mint = temp1[1];
                            const token = TokenEngine.getToken(mint);
                            if (token) {
                                token.amount_held = 0;
                                TelegramEngine.#bot.answerCallbackQuery(callbackQuery.id, {
                                    text: `✅ ${token.symbol} amount reset to 0`,
                                });
                                try {
                                    if (callbackQuery.message) {
                                        const { m, inn } = TelegramEngine.#getTokensContent();
                                        const done = await TelegramEngine.#bot.editMessageText(TelegramEngine.sanitizeMessage(m), {
                                            chat_id: Site.TG_CHAT_ID,
                                            message_id: callbackQuery.message.message_id,
                                            disable_web_page_preview: true,
                                            reply_markup: { ...callbackQuery.message.reply_markup, inline_keyboard: inn },
                                            parse_mode: "MarkdownV2",
                                        });
                                        if (done) {
                                            TelegramEngine.#previousTokensMessage = m;
                                        }
                                    }
                                } catch (error) {
                                    Log.dev(error);
                                }
                            }
                        }
                        else if (content.startsWith("rejoin ")) {
                            let temp1 = content.split(" ");
                            let mint = temp1[1];
                            const name = TelegramEngine.#blacklist[mint] + "";
                            delete TelegramEngine.#blacklist[mint];
                            TelegramEngine.#bot.answerCallbackQuery(callbackQuery.id, {
                                text: `✅ ${name} removed from blacklist`,
                            });
                            if (callbackQuery.message) {
                                const mid = callbackQuery.message.message_id;
                                const newInn = callbackQuery.message.reply_markup.inline_keyboard.filter(x => !x[0].callback_data.includes(mint));
                                try {
                                    if (newInn.length > 0) {
                                        TelegramEngine.#bot.editMessageReplyMarkup({ ...callbackQuery.message.reply_markup, inline_keyboard: newInn }, {
                                            chat_id: Site.TG_CHAT_ID,
                                            message_id: mid,
                                        });
                                    }
                                    else {
                                        TelegramEngine.#bot.editMessageText(`❌ No tokens are blacklisted`, {
                                            chat_id: Site.TG_CHAT_ID,
                                            message_id: mid,
                                        });
                                    }
                                } catch (error) {
                                    Log.dev(error);
                                }
                            }
                        }
                        else if (content.startsWith("blacklist ")) {
                            let temp1 = content.split(" ");
                            let mint = temp1[1];
                            const token = TokenEngine.getToken(mint);
                            if (token) {
                                TelegramEngine.#blacklist[mint] = token.name;
                                TelegramEngine.#bot.answerCallbackQuery(callbackQuery.id, {
                                    text: `✅ ${token.name}(${token.symbol}) is now hidden from tokens list`,
                                });
                                if (callbackQuery.message) {
                                    try {
                                        const { m, inn } = TelegramEngine.#getTokensContent();
                                        const done = await TelegramEngine.#bot.editMessageText(TelegramEngine.sanitizeMessage(m), {
                                            chat_id: Site.TG_CHAT_ID,
                                            message_id: callbackQuery.message.message_id,
                                            disable_web_page_preview: true,
                                            reply_markup: { ...callbackQuery.message.reply_markup, inline_keyboard: inn },
                                            parse_mode: "MarkdownV2",
                                        });
                                        if (done) {
                                            TelegramEngine.#previousTokensMessage = m;
                                        }
                                    } catch (error) {
                                        Log.dev(error);
                                    }
                                }
                            }
                        }
                        else if (content.startsWith("reloadtokens")) {
                            if (callbackQuery.message) {
                                try {
                                    const { m, inn } = TelegramEngine.#getTokensContent();
                                    const done = await TelegramEngine.#bot.editMessageText(TelegramEngine.sanitizeMessage(m), {
                                        chat_id: Site.TG_CHAT_ID,
                                        message_id: callbackQuery.message.message_id,
                                        disable_web_page_preview: true,
                                        reply_markup: { ...callbackQuery.message.reply_markup, inline_keyboard: inn },
                                        parse_mode: "MarkdownV2",
                                    });
                                    if (done) {
                                        TelegramEngine.#previousTokensMessage = m;
                                    }
                                    TelegramEngine.#bot.answerCallbackQuery(callbackQuery.id, {
                                        text: done ? `✅ Updated tokens` : `❌ Failed to update tokens`,
                                    });
                                } catch (error) {
                                    Log.dev(error);
                                }
                            }
                        }
                        else if (content.startsWith("reloadobserve")) {
                            try {
                                if (callbackQuery.message) {
                                    TelegramEngine.#bot.answerCallbackQuery(callbackQuery.id);
                                    const { message, inline } = TelegramEngine.#getObserveContent();
                                    if (message && message != TelegramEngine.#lastobservecontent) {
                                        TelegramEngine.#lastobservecontent = message;
                                        TelegramEngine.#bot.editMessageText(TelegramEngine.sanitizeMessage(message), {
                                            chat_id: Site.TG_CHAT_ID,
                                            message_id: callbackQuery.message.message_id,
                                            disable_web_page_preview: true,
                                            parse_mode: "MarkdownV2",
                                            reply_markup: {
                                                inline_keyboard: inline,
                                            }
                                        });
                                    }
                                }

                            } catch (error) {
                                Log.dev(error);
                            }
                        }
                        else if (content.startsWith("buynow ")) {
                            TelegramEngine.#bot.answerCallbackQuery(callbackQuery.id);
                            let temp1 = content.split(" ");
                            let mint = temp1[1];
                            try {
                                const token = TokenEngine.getToken(mint);
                                if (token) {
                                    const m = `Choose ${Site.BASE} amount to swap to ${token.symbol}`;
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
                                    }, opts);
                                }
                            } catch (error) {
                                Log.dev(error);
                            }
                        }
                        else if (content.startsWith("sellnow ")) {
                            TelegramEngine.#bot.answerCallbackQuery(callbackQuery.id);
                            let temp1 = content.split(" ");
                            let mint = temp1[1];
                            try {
                                const token = TokenEngine.getToken(mint);
                                if (token) {
                                    const m = `Choose percentage of ${token.symbol} ${FFF(token.amount_held)} to swap to ${Site.BASE}`;
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
                                    }, opts);
                                }
                            } catch (error) {
                                Log.dev(error);
                            }
                        }
                        else if (content.startsWith("delorder ")) {
                            let temp1 = content.split(" ");
                            let mint = temp1[1];
                            let index = parseInt(temp1[2]);
                            try {
                                const deleted = await TokenEngine.deleteLimitOrder(mint, index);
                                TelegramEngine.#bot.answerCallbackQuery(callbackQuery.id, {
                                    text: deleted ? `✅ Limit order deleted` : `❌ Could not delete limit order`,
                                });
                                if (callbackQuery.message) {
                                    const { m, inn } = TelegramEngine.#getTokensContent();
                                    const done = await TelegramEngine.#bot.editMessageText(TelegramEngine.sanitizeMessage(m), {
                                        chat_id: Site.TG_CHAT_ID,
                                        message_id: callbackQuery.message.message_id,
                                        disable_web_page_preview: true,
                                        reply_markup: { ...callbackQuery.message.reply_markup, inline_keyboard: inn },
                                        parse_mode: "MarkdownV2",
                                    });
                                    if (done) {
                                        TelegramEngine.#previousTokensMessage = m;
                                    }
                                }
                            } catch (error) {
                                Log.dev(error);
                            }
                        }
                        else if (content.startsWith("limit ")) {
                            TelegramEngine.#bot.answerCallbackQuery(callbackQuery.id);
                            let temp1 = content.split(" ");
                            let command = temp1[1];
                            if (command == "start") {
                                const mint = temp1[2];
                                const token = TokenEngine.getToken(mint);
                                if (token) {
                                    TelegramEngine.#limit = new LimitOrder();
                                    TelegramEngine.#limitMint = token.mint;
                                    const m = `*Order Type*`
                                    TelegramEngine.sendMessage(m, mid => {
                                        if (mid) {
                                            TelegramEngine.#limitLastMID = mid;
                                        }
                                    }, {
                                        parse_mode: "MarkdownV2",
                                        reply_markup: {
                                            inline_keyboard: [
                                                [
                                                    {
                                                        text: "BUY",
                                                        callback_data: "limit_type_buy"
                                                    },
                                                    {
                                                        text: "SELL",
                                                        callback_data: "limit_type_sell"
                                                    }
                                                ],
                                                [
                                                    {
                                                        text: "❌ Cancel",
                                                        callback_data: "cancel_limit",
                                                    }
                                                ]
                                            ]
                                        }
                                    });
                                }
                            }
                        }
                        else {
                            // console.log("unkmown command", content);
                        }
                    }
                }

            });

            TelegramEngine.#bot.on("polling_error", (err) => {
                // Log.dev(err);
                Log.flow(`Telegram > Polling error.`, 3);
            });
            TelegramEngine.#bot.on("webhook_error", (err) => {
                // Log.dev(err);
                Log.flow(`Telegram > Webhook error.`, 3);
            });

            Log.flow(`Telegram > Initialized.`, 0);
            resolve(true);
        })
    }

    static #messageQueue = [];
    static #processing = false;
    static #WINDOW_DURATION = 1000;
    static #windowStart = Date.now();
    static #globalCount = 0;
    static #chatCounts = {};

    static sendWarning = (warning) => {
        TelegramEngine.sendMessage(`🚨 *Warning*\n\n${warning}`);
    }

    /**
     * Sends message to user.
     * @param {string} message 
     * @param {(data: string|null) => void} callback
     * @param {TelegramBot.SendMessageOptions} opts
     * @param {boolean} isTemp
     * 
     */
    static sendMessage = (message, callback = () => { }, opts = {
        parse_mode: "MarkdownV2",
        disable_web_page_preview: true,
    }, isTemp = false,) => {
        TelegramEngine.#messageQueue.push({
            message,
            callback,
            opts,
            isTemp,
        });

        if (!TelegramEngine.#processing) {
            TelegramEngine.#processQueue();
        }
    }

    /**
     * @param {any} messageId 
     */
    static deleteMessage = (messageId) => {
        return new Promise((resolve, reject) => {
            TelegramEngine.#bot.deleteMessage(Site.TG_CHAT_ID, messageId).then(() => {
                resolve(true);
            }
            ).catch(err => {
                Log.dev(err);
                resolve(false);
            }
            );
        })
    }

    static #processQueue = async () => {
        TelegramEngine.#processing = true;

        while (TelegramEngine.#messageQueue.length > 0) {
            const now = Date.now();

            // Reset the counters if the window has passed
            if (now - TelegramEngine.#windowStart >= TelegramEngine.#WINDOW_DURATION) {
                TelegramEngine.#windowStart = now;
                TelegramEngine.#globalCount = 0;
                TelegramEngine.#chatCounts = {};
            }

            let sentAny = false;
            // Use  variable to track the minimal wait time needed for any blocked message
            let nextDelay = TelegramEngine.#WINDOW_DURATION;

            // Iterate through the queue and process eligible messages
            for (let i = 0; i < TelegramEngine.#messageQueue.length; i++) {
                const msg = TelegramEngine.#messageQueue[i];
                const chatCount = TelegramEngine.#chatCounts[msg.chatId] || 0;
                const globalLimitReached = TelegramEngine.#globalCount >= Site.MAX_MESSAGE_PER_SECOND;
                const chatLimitReached = chatCount >= Site.MAX_MESSAGE_PER_SECOND_PER_CHAT;

                // If sending this message does not exceed limits, send it immediately
                if (!globalLimitReached && !chatLimitReached) {
                    TelegramEngine.#globalCount++;
                    TelegramEngine.#chatCounts[msg.chatId] = chatCount + 1;
                    // Remove message from the queue and send it
                    TelegramEngine.#messageQueue.splice(i, 1);
                    // Adjust index due to removal
                    i--;
                    TelegramEngine.#sendIndividualMessage(msg);
                    sentAny = true;
                }
                else {
                    // Determine the delay required for either global or per-chat counter to reset
                    let globalDelay = globalLimitReached ? TelegramEngine.#WINDOW_DURATION - (now - TelegramEngine.#windowStart) : 0;
                    let chatDelay = chatLimitReached ? TelegramEngine.#WINDOW_DURATION - (now - TelegramEngine.#windowStart) : 0;
                    // The message will be eligible after the maximum of these two delays
                    const delayForMsg = Math.max(globalDelay, chatDelay);
                    // Save the minimal delay needed among all blocked messages
                    if (delayForMsg < nextDelay) {
                        nextDelay = delayForMsg;
                    }
                }
            }

            // if no messages were sent in this pass, wait for the minimal  required delay
            if (!sentAny) {
                await new Promise(resolve => setTimeout(resolve, nextDelay));
            }
        }

        TelegramEngine.#processing = false;
    }

    /**
     * Sanitize for markdown v2
     * @param {string} txt 
     * @returns {string}
     */
    static sanitizeMessage = (txt) => txt.replace(/([~>#\+\-=\|{}\.!])/g, '\\$&');

    static #lastMessageID = null;
    static #lastTokenMessageID = null

    static #sendIndividualMessage = (msg) => {
        const { callback, message, opts, isTemp } = msg;
        TelegramEngine.#bot.sendMessage(Site.TG_CHAT_ID, TelegramEngine.sanitizeMessage(message), opts).then((mess) => {
            Log.flow(`Telegram > Sent text.`, 3);
            if (!isTemp) {
                TelegramEngine.#lastMessageID = mess.message_id;
            }
            callback(mess.message_id);
        }).catch(err => {
            Log.dev(err);
            Log.flow(`Telegram > Error sending text.`, 3);
            callback(null);
        });
    }
}

module.exports = TelegramEngine;