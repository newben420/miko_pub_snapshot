const { VersionedTransaction, Connection, PublicKey, Transaction, sendAndConfirmTransaction } = require("@solana/web3.js");
const Site = require("../env");
const { Res } = require("../lib/res");
const { Token, LimitOrder } = require("./token_model");
const Log = require("../lib/log");
const { get } = require("../lib/make_request");
const WebSocket = require("ws");
const FFF = require("../lib/fff");
const SolPrice = require("./sol_price");
const getTimeElapsed = require("../lib/get_time_elapsed");
let TelegramEngine = null;
let WhaleEngine = null;

const METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

function getMetadataPDA(mint) {
    return PublicKey.findProgramAddressSync(
        [
            Buffer.from("metadata"),
            METADATA_PROGRAM_ID.toBuffer(),
            new PublicKey(mint).toBuffer(),
        ],
        METADATA_PROGRAM_ID
    )[0];
}

class TokenEngine {
    /**
     * @type {Record<string, Token>}
     */
    static #tokens = {};

    static getAllTokens = () => Object.keys(TokenEngine.#tokens).map(mint => TokenEngine.#tokens[mint]);


    static getTokensMint = () => {
        return Object.keys(TokenEngine.#tokens);
    }

    static getToken = (mint) => {
        return TokenEngine.#tokens[mint] || null;
    }

    /**
     * @type {boolean}
     */
    static autoBuy = Site.AU_AUTO_BUY;

    /**
     * @type {boolean}
     */
    static autoSell = Site.AU_AUTO_SELL;

    /**
     * @type {boolean}
     */
    static autoPD = Site.AU_AUTO_PEAKDROP;

    /**
     * Realized PnLs in simulation mode.
     * @type {any[]}
     */
    static realizedPnLSimulation = [];

    /**
     * Realized PnLs in live mode.
     * @type {any[]}
     */
    static realizedPnLLive = [];

    /**
    * Websocket reference.
    * @type {WebSocket|null}
    */
    static #ws = null;

    /**
     * Registers websocket.
     * @param {WebSocket} ws 
     */
    static registerSocket = (ws) => {
        TokenEngine.#ws = ws;
    }

    /**
     * Holds signatures of the recent successful transactions made by me
     * @type {string[]}
     */
    static #signatures = [];

    /**
     * Gets token information
     * @param {string} mint 
     * @returns {Promise<any>}
     */
    static getTokenInfo = (mint) => {
        return new Promise(async (resolve, reject) => {
            get(`${Site.PF_API}/coins/${mint}`, r => {
                if (r.succ) {
                    if (r.message.name && r.message.symbol) {
                        resolve({
                            name: (r.message.name || "").replace(/[^a-zA-Z0-9\s]/g, ""),
                            symbol: (r.message.symbol || "").replace(/[^a-zA-Z0-9\s]/g, ""),
                            description: (r.message.description || ""),
                        });
                    }
                    else {
                        resolve(null);
                    }
                }
                else {
                    resolve(null);
                }
            });
        })
    }

    /**
     * Holds number of successful transactions
     * @type {number}
     */
    static successfulTx = 0;

    /**
     * Indicates if a token is being removed
     * @type {Record<string, boolean>}
     */
    static #isBeingRemoved = {};

    static removeToken = (mint, callback = () => { }) => {
        return new Promise((resolve, reject) => {
            if (TokenEngine.#tokens[mint] && !TokenEngine.#isBeingRemoved[mint]) {
                TokenEngine.#isBeingRemoved[mint] = true;
                const token = TokenEngine.#tokens[mint];
                if (token.timeout_ref) {
                    clearInterval(token.timeout_ref);
                }
                TokenEngine.#stopObservation(mint);
                try {
                    const TelegramEngine = require("./telegram");
                    if (!WhaleEngine) {
                        WhaleEngine = require("./whale").WhaleEngine;
                    }
                    TelegramEngine.sendMessage(`❌ ${token.name} \\(${token.symbol}\\) has been removed after ${getTimeElapsed(token.last_updated, Date.now())} since it was last updated\n\nRegistered ⏱️ ${getTimeElapsed(token.reg_timestamp, Date.now())} ago${token.current_marketcap ? `\nCurrent MC 📈 ${Site.BASE} ${FFF(token.current_marketcap)} \\(USD ${FFF(token.current_marketcap * SolPrice.get())}\\)\nPeak MC 📈 ${Site.BASE} ${FFF(token.max_marketcap)} \\(USD ${FFF(token.max_marketcap * SolPrice.get())}\\)\nLeast MC 📈 ${Site.BASE} ${FFF(token.min_marketcap)} \\(USD ${FFF(token.min_marketcap * SolPrice.get())}\\)` : ''}${(token.pnl || token.max_pnl || token.min_pnl) ? `\nPnL 💰 ${Site.BASE} ${FFF(token.pnl_base)} \\(USD ${FFF(token.pnl_base * SolPrice.get())} | *${token.pnl.toFixed(2)}%*\\)\nMax PnL 💰 ${token.max_pnl.toFixed(2)}%\nMin PnL 💰 ${token.min_pnl.toFixed(2)}%\nEntry Reasons 🔵 ${Array.from(token.entry_reasons).map(r => `\`${r}\``).join(" | ")}\nExit Reasons 🟠 ${Array.from(token.exit_reasons).map(r => `\`${r}\``).join(" | ")}` : ``}\n\n\`${token.mint}\``, mid => {
                        if (TokenEngine.#tokens[mint]) {
                            if (TokenEngine.#tokens[mint].pnl_base) {
                                if (Site.SIMULATION && TokenEngine.#tokens[mint].added_in_simulation) {
                                    if (TokenEngine.realizedPnLSimulation.length > 0 ? (TokenEngine.realizedPnLSimulation[TokenEngine.realizedPnLSimulation.length - 1] != TokenEngine.#tokens[mint].pnl_base) : true) {
                                        TokenEngine.realizedPnLSimulation.push({pnl: TokenEngine.#tokens[mint].pnl_base, ts: TokenEngine.#tokens[mint].reg_timestamp});
                                    }
                                }
                                else if((!Site.SIMULATION) && (!TokenEngine.#tokens[mint].added_in_simulation)) {
                                    if (TokenEngine.realizedPnLLive.length > 0 ? (TokenEngine.realizedPnLLive[TokenEngine.realizedPnLLive.length - 1] != TokenEngine.#tokens[mint].pnl_base) : true) {
                                        TokenEngine.realizedPnLLive.push({pnl: TokenEngine.#tokens[mint].pnl_base, ts: TokenEngine.#tokens[mint].reg_timestamp});
                                    }
                                }
                            }
                        }
                        const wh = WhaleEngine.removeForTelegram(token.mint, TokenEngine.#tokens[mint].name, TokenEngine.#tokens[mint].symbol);
                        if (wh) {
                            TelegramEngine.sendMessage(wh);
                        }
                        delete TokenEngine.#tokens[mint];
                        delete TokenEngine.#pdLastExec[mint];
                        delete TokenEngine.#isBeingRemoved[mint];
                    });
                } catch (error) {
                    Log.dev(error);
                    delete TokenEngine.#tokens[mint];
                    delete TokenEngine.#pdLastExec[mint];
                    delete TokenEngine.#isBeingRemoved[mint];
                }
                finally {
                    callback();
                    resolve("");
                }
            }
        })
    }

    /**
    * Starts observing a token.
    * @param {string} mint - Token mint address.
    */
    static #startObservation = (mint) => {
        let payload = {
            method: "subscribeTokenTrade",
            keys: [mint]
        }
        TokenEngine.#ws.send(JSON.stringify(payload));
    }

    /**
    * Stops observing a token.
    * @param {string} mint - Token mint address.
    */
    static #stopObservation = (mint) => {
        let payload = {
            method: "unsubscribeTokenTrade",
            keys: [mint]
        }
        TokenEngine.#ws.send(JSON.stringify(payload));
    }


    /**
     * Register a token with the engine.
     * @param {string} mint 
     * @param {'Telegram'|'Kiko'|'Unspecified'|'Recovery'} source
     * @returns {Promise<boolean>}
     */
    static registerToken = (mint, source) => {
        return new Promise(async (resolve, reject) => {
            if (TokenEngine.#tokens[mint]) {
                resolve(false);
            }
            else {
                const metadata = await TokenEngine.getTokenInfo(mint);
                if (metadata) {
                    const { name, symbol, description } = metadata;
                    TokenEngine.#startObservation(mint);
                    TokenEngine.#tokens[mint] = new Token(name, symbol, mint, description, source);
                    TokenEngine.#tokens[mint].remove_ref = TokenEngine.removeToken;
                    if ((Site.AU_BUY_DESC_REQUIRED ? description : true) && TokenEngine.autoBuy && TokenEngine.#tokens[mint].source == "Kiko") {
                        for (const autoBuy of Site.AU_BUY) {
                            let o = new LimitOrder();
                            o.type = "buy";
                            o.marketcap = autoBuy.mc * -1;
                            o.amount = autoBuy.buyAmt;
                            o.min_time = autoBuy.minTime;
                            o.max_time = autoBuy.maxTime;
                            TokenEngine.#tokens[mint].pending_orders.push(o);
                        }
                    }
                    resolve(true);
                }
                else {
                    resolve(false);
                }
            }
        })
    }

    /**
     * Register limit order
     * @param {string} mint 
     * @param {LimitOrder} order 
     * @returns {Promise<boolean>}
     */
    static registerLimitOrder = (mint, order) => {
        return new Promise((resolve, reject) => {
            const token = TokenEngine.getToken(mint);
            if (token) {
                token.pending_orders.push(order);
                resolve(true);
            }
            else {
                resolve(false);
            }
        })
    }

    /**
     * Register limit order
     * @param {string} mint 
     * @param {number} index
     * @returns {Promise<boolean>}
     */
    static deleteLimitOrder = (mint, index) => {
        return new Promise((resolve, reject) => {
            const token = TokenEngine.getToken(mint);
            if (token) {
                token.pending_orders.splice(index, 1);
                resolve(true);
            }
            else {
                resolve(false);
            }
        })
    }

    /**
     * Keeps track of execution of limit orders per token
     * @type {Record<string, boolean>}
     */
    static #limitExec = {}

    /**
     * Holds timestamp of last peakdrop execution so a cool down period can be implemented
     * @type {Record<string, number>}
     */
    static #pdLastExec = {}

    /**
     * Called when there is a new trade that occured on any token I am subscribed to
     * @param {any} message 
     */
    static newTrade = async (message) => {
        const mint = message.mint;
        if (TokenEngine.#tokens[mint]) {
            // registered token
            const rate = message.solAmount / message.tokenAmount;
            const mcSol = message.marketCapSol;
            const actor = message.traderPublicKey;

            if (rate ? (rate > 0) : false) {
                if (!TokenEngine.#tokens[mint].first_signal) {
                    if (!TelegramEngine) {
                        TelegramEngine = require("./telegram");
                    }
                    const token = TokenEngine.#tokens[mint];
                    if (token) {
                        TelegramEngine.sendMessage(`🚀 ${token.name} \\(${token.symbol}\\) has received its first update and is now available for trading`);
                        TokenEngine.#tokens[mint].first_signal = true;
                    }
                }
                if (rate > TokenEngine.#tokens[mint].peak_price || TokenEngine.#tokens[mint].peak_price === 0) {
                    TokenEngine.#tokens[mint].peak_price = rate;
                }
                if (rate < TokenEngine.#tokens[mint].least_price || TokenEngine.#tokens[mint].least_price === 0) {
                    TokenEngine.#tokens[mint].least_price = rate;
                }
                TokenEngine.#tokens[mint].current_price = rate;
                if (rate > TokenEngine.#tokens[mint].temp_high || TokenEngine.#tokens[mint].temp_high === 0) {
                    TokenEngine.#tokens[mint].temp_high = rate;
                }
                if (rate < TokenEngine.#tokens[mint].temp_low || TokenEngine.#tokens[mint].temp_low === 0) {
                    TokenEngine.#tokens[mint].temp_low = rate;
                }
                if (TokenEngine.#tokens[mint].temp_open == 0) {
                    TokenEngine.#tokens[mint].temp_open = rate;
                }
                const PnL = ((TokenEngine.#tokens[mint].total_sold_base + (TokenEngine.#tokens[mint].current_price * TokenEngine.#tokens[mint].amount_held)) - TokenEngine.#tokens[mint].total_bought_base);
                const pnlPerc = (((PnL / TokenEngine.#tokens[mint].total_bought_base) * 100) || 0);
                TokenEngine.#tokens[mint].pnl_base = PnL;
                TokenEngine.#tokens[mint].pnl = pnlPerc;
                if (pnlPerc > TokenEngine.#tokens[mint].max_pnl || TokenEngine.#tokens[mint].max_pnl === 0) {
                    // UPDATE TRAILING STOP LOSSES
                    for (let i = 0; i < TokenEngine.#tokens[mint].pending_orders.length; i++) {
                        let order = TokenEngine.#tokens[mint].pending_orders[i];
                        if (order.trailing) {
                            const pMC = Site.BASE_DENOMINATED ? TokenEngine.#tokens[mint].current_marketcap : (TokenEngine.#tokens[mint].current_marketcap * SolPrice.get());
                            // console.log(TokenEngine.#tokens[mint].name, "Trailing Stop Loss", `${TokenEngine.#tokens[mint].pending_orders[i].marketcap} => ${((((order.perc * pMC) / 100) + pMC) * -1)}`, "Max PnL", `${TokenEngine.#tokens[mint].max_pnl.toFixed(2)} => ${pnlPerc.toFixed(2)}%`, "Current MC", `${TokenEngine.#tokens[mint].current_marketcap}`);
                            order.marketcap = ((((order.perc * pMC) / 100) + pMC) * -1);
                        }
                    }
                    TokenEngine.#tokens[mint].max_pnl = pnlPerc;
                }
                if (pnlPerc < TokenEngine.#tokens[mint].min_pnl || TokenEngine.#tokens[mint].min_pnl === 0) {
                    TokenEngine.#tokens[mint].min_pnl = pnlPerc;
                }
            }

            if (mcSol ? (mcSol > 0) : false) {
                if (mcSol > TokenEngine.#tokens[mint].max_marketcap || TokenEngine.#tokens[mint].max_marketcap === 0) {
                    TokenEngine.#tokens[mint].max_marketcap = mcSol;
                }
                if (mcSol < TokenEngine.#tokens[mint].min_marketcap || TokenEngine.#tokens[mint].min_marketcap === 0) {
                    TokenEngine.#tokens[mint].min_marketcap = mcSol;
                }
            }

            TokenEngine.#tokens[mint].temp_volume += message.solAmount;
            TokenEngine.#tokens[mint].current_marketcap = mcSol;
            TokenEngine.#tokens[mint].last_updated = Date.now();
            const mc = Site.BASE_DENOMINATED ? mcSol : (mcSol * SolPrice.get());
            if (!TokenEngine.#limitExec[mint]) {
                TokenEngine.#limitExec[mint] = true;
                for (let i = 0; i < TokenEngine.#tokens[mint].pending_orders.length; i++) {
                    let order = TokenEngine.#tokens[mint].pending_orders[i];
                    const sufficient = order.type == "buy" ? true : (order.amount <= TokenEngine.#tokens[mint].amount_held);
                    const allocation = TokenEngine.#tokens[mint].amount_held + 0;
                    const timeEla = Date.now() - TokenEngine.#tokens[mint].reg_timestamp;
                    if (order.min_time ? (timeEla >= order.min_time) : true) {
                        if (order.max_time ? (timeEla <= order.max_time) : true) {
                            if ((order.type == "buy" && order.marketcap > 0) || (order.type == "sell" && order.marketcap < 0)) {
                                // less than or equal to
                                if (mc <= Math.abs(order.marketcap) && sufficient && (order.trailing ? ((TokenEngine.#tokens[mint].pnl >= order.min_sell_pnl) && (TokenEngine.#tokens[mint].pnl <= order.max_sell_pnl)) : true)) {
                                    // condition for this order has been fulfilled
                                    const done = order.type == "buy" ? (await TokenEngine.buy(mint, order.amount, `Limit MC < ${Site.BASE_DENOMINATED ? Site.BASE : "USD"} ${FFF(Math.abs(order.marketcap))}`, Site.TRADE_MAX_RETRIES, [0, order.marketcap])) : (await TokenEngine.sell(mint, order.amount, `${order.trailing ? `TSL MC` : `Limit MC`} < ${Site.BASE_DENOMINATED ? Site.BASE : "USD"} ${FFF(Math.abs(order.marketcap))}`, Site.TRADE_MAX_RETRIES, [0, order.marketcap]));
                                    if (done) {
                                        if (!TelegramEngine) {
                                            TelegramEngine = require("./telegram");
                                        }
                                        if (Site.SIMULATION) {
                                            if (order.type == "buy") {
                                                TelegramEngine.sendMessage(`✅ *BUY*\n\nLimit Swapped ${Site.BASE} ${FFF(order.amount)} \\(USD ${FFF(order.amount * SolPrice.get())}\\) to ${TokenEngine.#tokens[mint].symbol} ${FFF(done)}\n\nMC 📈 ${Site.BASE} ${FFF(TokenEngine.#tokens[mint].current_marketcap)} \\(USD ${FFF(TokenEngine.#tokens[mint].current_marketcap * SolPrice.get())}\\)\nPrice 💰 ${Site.BASE} ${FFF(TokenEngine.#tokens[mint].current_price)}\n`);
                                            }
                                            else {
                                                TelegramEngine.sendMessage(`✅ *SELL*\n\nLimit Swapped ${TokenEngine.#tokens[mint].symbol} ${FFF(((order.amount / 100) * allocation) || 0)} \\(${order.amount}%\\) to ${Site.BASE} ${FFF(done)} \\(USD ${FFF(done * SolPrice.get())}\\)\n\nMC 📈 ${Site.BASE} ${FFF(TokenEngine.#tokens[mint].current_marketcap)} \\(USD ${FFF(TokenEngine.#tokens[mint].current_marketcap * SolPrice.get())}\\)\nPrice 💰 ${Site.BASE} ${FFF(TokenEngine.#tokens[mint].current_price)}\n`);
                                            }
                                        }
                                        else {
                                            TelegramEngine.sendMessage(`✅ *${order.type.toUpperCase()}*\n\nLimit order executed on ${TokenEngine.#tokens[mint].symbol}\n\n🪧 \`${done}\``);
                                        }
                                        TokenEngine.#tokens[mint].pending_orders.splice(i, 1);
                                        i--;
                                        break;
                                    }
                                }
                            }
                            else {
                                // greater than or equal to
                                if (mc >= Math.abs(order.marketcap) && sufficient) {
                                    // condition for this order has been fulfilled
                                    const done = order.type == "buy" ? (await TokenEngine.buy(mint, order.amount, `Limit MC > ${Site.BASE_DENOMINATED ? Site.BASE : "USD"} ${FFF(Math.abs(order.marketcap))}`, Site.TRADE_MAX_RETRIES, [order.marketcap, 0])) : (await TokenEngine.sell(mint, order.amount, `${order.trailing ? `TSL MC` : `Limit MC`} > ${Site.BASE_DENOMINATED ? Site.BASE : "USD"} ${FFF(Math.abs(order.marketcap))}`, Site.TRADE_MAX_RETRIES, [order.marketcap, 0]));
                                    if (done) {
                                        if (!TelegramEngine) {
                                            TelegramEngine = require("./telegram");
                                        }
                                        if (Site.SIMULATION) {
                                            if (order.type == "buy") {
                                                TelegramEngine.sendMessage(`✅ *BUY*\n\nLimit swapped ${Site.BASE} ${FFF(order.amount)} \\(USD ${FFF(order.amount * SolPrice.get())}\\) to ${TokenEngine.#tokens[mint].symbol} ${FFF(done)}\n\nMC 📈 ${Site.BASE} ${FFF(TokenEngine.#tokens[mint].current_marketcap)} \\(USD ${FFF(TokenEngine.#tokens[mint].current_marketcap * SolPrice.get())}\\)\nPrice 💰 ${Site.BASE} ${FFF(TokenEngine.#tokens[mint].current_price)}\n`);
                                            }
                                            else {
                                                TelegramEngine.sendMessage(`✅ *SELL*\n\nLimit swapped ${TokenEngine.#tokens[mint].symbol} ${FFF(((order.amount / 100) * allocation) || 0)} \\(${order.amount}%\\) to ${Site.BASE} ${FFF(done)} \\(USD ${FFF(done * SolPrice.get())}\\)\n\nMC 📈 ${Site.BASE} ${FFF(TokenEngine.#tokens[mint].current_marketcap)} \\(USD ${FFF(TokenEngine.#tokens[mint].current_marketcap * SolPrice.get())}\\)\nPrice 💰 ${Site.BASE} ${FFF(TokenEngine.#tokens[mint].current_price)}\n`);
                                            }
                                        }
                                        else {
                                            TelegramEngine.sendMessage(`✅ *${order.type.toUpperCase()}*\n\nLimit order executed on ${TokenEngine.#tokens[mint].symbol}\n\n🪧 \`${done}\``);
                                        }
                                        TokenEngine.#tokens[mint].pending_orders.splice(i, 1);
                                        i--;
                                        break;
                                    }
                                }
                            }
                        }
                        else {
                            // remove order because it has expired
                            TokenEngine.#tokens[mint].pending_orders.splice(i, 1);
                            i--;
                        }
                    }
                }
                delete TokenEngine.#limitExec[mint];
            }

            if (actor == Site.DE_LOCAL_PUB_KEY && (!Site.SIMULATION)) {
                if (message.signature) {
                    TokenEngine.#signatures.push(message.signature);
                    if (TokenEngine.#signatures.length > Site.SIGNATURES_MAX_LENGTH) {
                        TokenEngine.#signatures = TokenEngine.#signatures.slice(TokenEngine.#signatures.length - Site.SIGNATURES_MAX_LENGTH);
                    }
                }
                // The trade was made by me
                const token = TokenEngine.#tokens[mint];
                if (token) {
                    if (!TelegramEngine) {
                        TelegramEngine = require("./telegram");
                    }
                    if (message.txType == "buy") {
                        // The trade was a buy
                        TokenEngine.#tokens[mint].amount_held += message.tokenAmount;
                        TokenEngine.#tokens[mint].total_bought_base += message.solAmount;
                        const amt = message.solAmount;
                        const bought = message.tokenAmount;
                        TelegramEngine.sendMessage(`✅ *BUY*\n\nSwapped ${Site.BASE} ${FFF(amt)} \\(USD ${FFF(amt * SolPrice.get())}\\) to ${token.symbol} ${FFF(bought)}\n\nMC 📈 ${Site.BASE} ${FFF(token.current_marketcap)} \\(USD ${FFF(token.current_marketcap * SolPrice.get())}\\)\nPrice 💰 ${Site.BASE} ${FFF(token.current_price)}\n`);
                        if (!TokenEngine.#tokens[mint].bought_once) {
                            if (TokenEngine.autoSell && TokenEngine.#tokens[mint].source == "Kiko") {
                                let buyMC = Site.BASE_DENOMINATED ? TokenEngine.#tokens[mint].current_marketcap : (TokenEngine.#tokens[mint].current_marketcap * SolPrice.get());
                                for (const autoSell of Site.AU_SELL) {
                                    let sellMC = ((autoSell.pnl * buyMC) / 100) + buyMC;
                                    let o = new LimitOrder();
                                    o.amount = autoSell.perc;
                                    o.type = "sell";
                                    o.marketcap = sellMC * (autoSell.pnl > 0 ? 1 : -1);
                                    if (autoSell.trailing) {
                                        o.perc = autoSell.pnl;
                                        o.min_sell_pnl = autoSell.minPnL;
                                        o.max_sell_pnl = autoSell.maxPnL;
                                        o.trailing = true;
                                    }
                                    TokenEngine.#tokens[mint].pending_orders.push(o);
                                }
                            }
                            TokenEngine.#tokens[mint].bought_once = true;
                        }
                    }
                    else {
                        // The trade was a sell
                        const perc = Math.floor(((message.tokenAmount / TokenEngine.#tokens[mint].amount_held) * 100) || 0)
                        TokenEngine.#tokens[mint].amount_held -= message.tokenAmount;
                        if (TokenEngine.#tokens[mint].amount_held <= Site.ZERO_THRESHOLD) {
                            TokenEngine.#tokens[mint].amount_held = 0;
                        }
                        if (TokenEngine.#tokens[mint].total_bought_base > 0) {
                            TokenEngine.#tokens[mint].total_sold_base += message.solAmount;
                        }
                        const sold = message.solAmount;
                        TelegramEngine.sendMessage(`✅ *SELL*\n\nSwapped ${token.symbol} ${FFF(message.tokenAmount)} \\(${perc}%\\) to ${Site.BASE} ${FFF(sold)} \\(USD ${FFF(sold * SolPrice.get())}\\)\n\nMC 📈 ${Site.BASE} ${FFF(token.current_marketcap)} \\(USD ${FFF(token.current_marketcap * SolPrice.get())}\\)\nPrice 💰 ${Site.BASE} ${FFF(token.current_price)}\n`);
                    }
                }
            }

            if (TokenEngine.#tokens[mint].amount_held >= 0 && TokenEngine.autoPD && (Date.now() - (TokenEngine.#pdLastExec[mint] || 0)) >= 1000 && TokenEngine.#tokens[mint].source == "Kiko") {
                for (let i = 0; i < Site.AU_PEAKDROP.length; i++) {
                    if (TokenEngine.#tokens[mint].executed_peak_drops.indexOf(i) >= 0) {
                        continue;
                    }
                    const pd = Site.AU_PEAKDROP[i];
                    const pnl = TokenEngine.#tokens[mint].pnl;
                    const maxPnl = TokenEngine.#tokens[mint].max_pnl;
                    const allocation = TokenEngine.#tokens[mint].amount_held + 0;
                    const drop = maxPnl - pnl;
                    const reached = pnl >= pd.minPnLPerc && (pd.maxPnLPerc ? (pnl <= pd.maxPnLPerc) : true) && drop >= pd.minDropPerc;
                    if (reached) {
                        TokenEngine.#pdLastExec[mint] = Date.now();
                        const done = await TokenEngine.sell(mint, pd.sellPerc, `Peak Drop ${drop.toFixed(2)}%`, Site.TRADE_MAX_RETRIES, [0, 0]);
                        if (done) {
                            if (!TelegramEngine) {
                                TelegramEngine = require("./telegram");
                            }
                            if (Site.SIMULATION) {
                                TelegramEngine.sendMessage(`✅ *SELL*\n\nPeak Drop swapped ${TokenEngine.#tokens[mint].symbol} ${FFF(((pd.sellPerc / 100) * allocation) || 0)} \\(${pd.sellPerc}%\\) to ${Site.BASE} ${FFF(done)} \\(USD ${FFF(done * SolPrice.get())}\\)\n\nMC 📈 ${Site.BASE} ${FFF(TokenEngine.#tokens[mint].current_marketcap)} \\(USD ${FFF(TokenEngine.#tokens[mint].current_marketcap * SolPrice.get())}\\)\nPrice 💰 ${Site.BASE} ${FFF(TokenEngine.#tokens[mint].current_price)}\n`);
                            }
                            else {
                                TelegramEngine.sendMessage(`✅ *SELL*\n\nPeak Drop executed on ${TokenEngine.#tokens[mint].symbol}\n\n🪧 \`${done}\``);
                            }
                            TokenEngine.#tokens[mint].executed_peak_drops.push(i);
                            break;
                        }
                    }
                }
            }

            if (mc <= Site.MIN_MARKET_CAP && (TokenEngine.#tokens[mint] || {}).amount_held === 0) {
                TokenEngine.removeToken(mint);
            }
        }
    }

    /**
     * RPC connection.
     * @type {Connection}
     */
    static #conn = new Connection(Site.EX_RPC, 'confirmed');

    // SOL HELPER FUNCTIONS

    /**
     * Get signer's balance
     * @returns {Promise<null|number>}
     */
    static getBalance = () => {
        return new Promise(async (resolve, reject) => {
            try {
                const bal = await TokenEngine.#conn.getBalance(new PublicKey(Site.DE_LOCAL_PUB_KEY));
                resolve(bal / 1e9);
            } catch (error) {
                Log.dev(error);
                resolve(null)
            }
        })
    }

    /**
     * Get token accounts.
     * @returns {Promise<any[]|null>} An array of {pubKey, balance} or null
     */
    static getTokenAccounts = () => {
        return new Promise(async (resolve, reject) => {
            try {
                const tokenAccounts = await TokenEngine.#conn.getParsedTokenAccountsByOwner(new PublicKey(Site.DE_LOCAL_PUB_KEY), { programId: new PublicKey(Site.TOKEN_PROGRAM_ID) });
                if (tokenAccounts.value.length == 0) {
                    resolve([]);
                }
                else {
                    resolve(tokenAccounts.value.map(x => ({ pubKey: new PublicKey(x.pubkey), balance: x.account.data.parsed.info.tokenAmount.uiAmount || 0, mint: x.account.data.parsed.info.mint })));
                }
            } catch (error) {
                Log.dev(error);
                resolve(null);
            }
        })
    }

    /**
     * Close token accounts.
     * @param {any[]} data - An array of {pubKey, balance}
     * @returns {Promise<boolean>}
     */
    static closeTokenAccounts = (data) => {
        return new Promise(async (resolve, reject) => {
            try {
                let nonZeroAccounts = data.filter(x => x.balance == 0);
                if (nonZeroAccounts.length == 0) {
                    resolve(true);
                }
                else {
                    const tx = new Transaction();
                    for (const acc of nonZeroAccounts) {
                        tx.add({
                            keys: [
                                {
                                    pubkey: acc.pubKey, isSigner: false, isWritable: true,
                                },
                                {
                                    pubkey: new PublicKey(Site.DE_LOCAL_PUB_KEY), isSigner: false, isWritable: true,
                                },
                                {
                                    pubkey: new PublicKey(Site.DE_LOCAL_PUB_KEY), isSigner: true, isWritable: false,
                                }
                            ],
                            programId: Site.TOKEN_PROGRAM_ID,
                            data: Buffer.from([9])
                        });
                    }
                    tx.feePayer = new PublicKey(Site.DE_LOCAL_PUB_KEY);
                    tx.recentBlockhash = (await TokenEngine.#conn.getLatestBlockhash()).blockhash;
                    tx.sign(Site.DE_LOCAL_KEYPAIR);
                    const signature = await TokenEngine.#conn.sendRawTransaction(tx.serialize(), {
                        skipPreflight: false,
                        preflightCommitment: "confirmed"
                    });
                    resolve(true);
                }
            } catch (error) {
                Log.dev(error);
                resolve(false);
            }
        })
    }

    /**
     * Recovery.
     * @returns {Promise<boolean>}
     */
    static recovery = () => {
        return new Promise(async (resolve, reject) => {
            Log.flow('TE > Recovery > Fetching token accounts.', 1);
            const tokenAccounts = await TokenEngine.getTokenAccounts();
            if (tokenAccounts) {
                Log.flow(`TE > Recovery > Found ${tokenAccounts.length} token account${tokenAccounts.length == 1 ? '' : 's'}.`, 1);
                const neta = tokenAccounts.filter(x => x.balance > 0).length;
                const eta = tokenAccounts.length - neta;
                if (eta > 0) {
                    const closed = await TokenEngine.closeTokenAccounts(tokenAccounts);
                    if (closed) {
                        Log.flow(`TE > Recovery > Closed ${eta} empty token account${eta == 1 ? '' : 's'}.`, 1);
                    }
                    else {
                        Log.flow(`TE > Recovery > Error > Could not close ${eta} empty token account${eta == 1 ? '' : 's'}.`, 1);
                    }
                }
                if (neta > 0) {
                    Log.flow(`TE > Recovery > Registering ${neta} found non-empty token account${eta == 1 ? '' : 's'}.`, 1);
                    const mints = tokenAccounts.filter(x => x.balance > 0).map(x => x.mint);
                    setTimeout(async () => {
                        for (const mint of mints) {
                            if (TokenEngine.getTokensMint().indexOf(mint) >= 0) {
                                // DO NOTHING
                            }
                            else {
                                const r = await TokenEngine.registerToken(mint, "Recovery");
                                if (TokenEngine.#tokens[mint]) {
                                    TokenEngine.#tokens[mint].amount_held = ((tokenAccounts.filter(x => x.mint == mint)[0] || {}).balance || 0);
                                }
                            }
                        }
                        const soldOff = tokenAccounts.filter(x => x.balance > 0 && x.balance <= Site.ZERO_THRESHOLD && TokenEngine.#tokens[x.mint]).map(x => x.mint);
                        if (soldOff.length > 0 && !Site.SIMULATION) {
                            Log.flow(`TE > Recovery > Sold off ${soldOff.length} token account${soldOff.length == 1 ? '' : 's'}.`, 1);
                            for (const mint of soldOff) {
                                const signature = await TokenEngine.sell(mint, 100, "Sold off", 2, [0, 0]);
                                if (signature) {
                                    Log.flow(`TE > Recovery > Sold off ${TokenEngine.#tokens[mint].symbol} (${mint}) for ${signature}`, 1);
                                    try {
                                        if (!TelegramEngine) {
                                            TelegramEngine = require("./telegram");
                                        }
                                        TelegramEngine.sendMessage(`✅ *SELL*\n\nSold off ${(TokenEngine.#tokens[mint] || {}).name} \\(${(TokenEngine.#tokens[mint] || {}).symbol}\\)\n\n\`${mint}\`\n\n\`${signature}\``);
                                    } catch (error) {
                                        Log.dev(error);
                                    }
                                }
                            }
                        }
                    }, 5000);
                }
                resolve(true);
            }
            else {
                Log.flow('TE > Recovery > Error > Could not get token accounts.', 1);
                resolve(false);
            }
        })
    }

    /**
     * Init functionality
     * @returns {Promise<boolean>}
     */
    static init = () => {
        return new Promise(async (resolve, reject) => {
            if (Site.AUTO_RECOVERY) {
                Log.flow('TE > Init > Attempting recovery.', 0);
                const recovered = await TokenEngine.recovery();
                Log.flow(`TE > Init > Recovery ${(!recovered) ? 'failed' : 'succeeded'}.`, 0);
            }
            resolve(true);
        });
    }


    /**
     * Buy operation
     * @param {string} mint - Mint address of buy token 
     * @param {number} amt - amt of SOL to use to buy
     * @param {string} reason - Reason for the buy
     * @param {number} retries - The number of times the trade can be retried if not successful.
     * @param {number[]} marketcapLimit - The token marketcap limit for retries.
     * @returns {Promise<number|string>}
     */
    static buy = (mint, amt, reason, retries = 0, marketcapLimit = [0, 0]) => {
        return new Promise(async (resolve, reject) => {
            const token = TokenEngine.getToken(mint);
            if (token) {
                if (!WhaleEngine) {
                    WhaleEngine = require("./whale").WhaleEngine;
                }
                if (Site.SIMULATION) {
                    if (token.current_price && WhaleEngine.enter(mint)) {
                        const amtBought = amt / token.current_price;
                        token.amount_held += amtBought;
                        token.total_bought_base += amt;
                        if (!TokenEngine.#tokens[mint].bought_once) {
                            if (TokenEngine.autoSell && token.source == "Kiko") {
                                let buyMC = Site.BASE_DENOMINATED ? TokenEngine.#tokens[mint].current_marketcap : (TokenEngine.#tokens[mint].current_marketcap * SolPrice.get());
                                for (const autoSell of Site.AU_SELL) {
                                    let sellMC = ((autoSell.pnl * buyMC) / 100) + buyMC;
                                    let o = new LimitOrder();
                                    o.amount = autoSell.perc;
                                    o.type = "sell";
                                    o.marketcap = sellMC * (autoSell.pnl > 0 ? 1 : -1);
                                    if (autoSell.trailing) {
                                        o.perc = autoSell.pnl;
                                        o.min_sell_pnl = autoSell.minPnL;
                                        o.max_sell_pnl = autoSell.maxPnL;
                                        o.trailing = true;
                                    }
                                    TokenEngine.#tokens[mint].pending_orders.push(o);
                                }
                            }
                            TokenEngine.#tokens[mint].bought_once = true;
                        }
                        token.entry_reasons.add(reason);
                        WhaleEngine.addSelfAction(mint, `B${amt}`);
                        resolve(amtBought);
                    }
                    else {
                        resolve(0);
                    }
                }
                else {
                    const bought = await TokenEngine.#trade("buy", mint, amt, retries, marketcapLimit);
                    if (bought.succ) {
                        token.entry_reasons.add(reason);
                        WhaleEngine.addSelfAction(mint, `B${amt}`);
                        resolve(bought.message);
                    }
                    else {
                        Log.flow(`TE > Buy > Error > ${bought.message}`, 1);
                        resolve(0);
                    }
                }
            }
            else {
                resolve(0);
            }
        });
    }

    /**
     * Sell operation
     * @param {string} mint - Mint address of buy token 
     * @param {number} perc - perc of token holding to sell
     * @param {string} reason - Reason for the sell
     * @param {number} retries - The number of times the trade can be retried if not successful.
     * @param {number[]} marketcapLimit - The token marketcap limit for retries.
     * @returns {Promise<number|string>}
     */
    static sell = (mint, perc, reason, retries = 0, marketcapLimit = [0, 0]) => {
        return new Promise(async (resolve, reject) => {
            const token = TokenEngine.getToken(mint);
            if (token) {
                if (!WhaleEngine) {
                    WhaleEngine = require("./whale").WhaleEngine;
                }
                if (Site.SIMULATION) {
                    if (token.current_price) {
                        const amtToSell = (perc / 100) * token.amount_held;
                        const solAmt = amtToSell * token.current_price;
                        token.amount_held -= amtToSell;
                        if (token.total_bought_base > 0) {
                            token.total_sold_base += solAmt;
                        }
                        token.exit_reasons.add(reason);
                        WhaleEngine.addSelfAction(mint, `S${perc}`);
                        resolve(solAmt);
                    }
                    else {
                        resolve(0);
                    }
                }
                else {
                    const sold = await TokenEngine.#trade("sell", mint, `${perc}%`, retries, marketcapLimit);
                    if (sold.succ) {
                        token.exit_reasons.add(reason);
                        WhaleEngine.addSelfAction(mint, `S${perc}`);
                        resolve(sold.message);
                    }
                    else {
                        Log.flow(`TE > Sell > Error > ${sold.message}`, 1);
                        resolve(0);
                    }
                }
            }
            else {
                resolve(0);
            }
        });
    }


    /**
     * Local trade functionality.
     * @param {'buy' | 'sell'} action - either "buy" OR "sell".
     * @param {string} mint - Mint address of the token.
     * @param {number|string} amt - Amount.
     * @param {number} retries - The number of times the trade can be retried if not successful.
     * @param {number[]} marketcapLimit - The token marketcap limit for retries.
     * @param {string[]} signCache - Past signatures of the same transaction attempts.
     * @returns {Promise<Res>}
     */
    static #trade = (
        action,
        mint,
        amt,
        retries = 0,
        marketcapLimit = [0, 0],
        signCache = [],
    ) => {
        if (!WhaleEngine) {
            WhaleEngine = require("./whale").WhaleEngine;
        }
        return new Promise(async (resolve, reject) => {
            if ((action == "buy" && WhaleEngine.enter(mint)) || (action == "sell")) {
                const body = {
                    action,
                    publicKey: Site.DE_LOCAL_PUB_KEY,
                    mint,
                    amount: amt,
                    denominatedInSol: action === "buy" ? "true" : "false",
                    slippage: action === "buy" ? Site.DE_SLIPPAGE_PERC_ENTRY : Site.DE_SLIPPAGE_PERC_EXIT,
                    pool: Site.DE_POOL,
                    priorityFee: 0,
                }
                try {
                    const response = await fetch(Site.DE_LOCAL_URL, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify(body)
                    });
                    if (response.status === 200) {
                        const data = await response.arrayBuffer();
                        const tx = VersionedTransaction.deserialize(new Uint8Array(data));
                        const signerKeyPair = Site.DE_LOCAL_KEYPAIR;
                        /**
                         * @type {string}
                         */
                        let signature;
                        tx.sign([signerKeyPair]);
                        /**
                         * @type {Connection}
                         */
                        const conn = TokenEngine.#conn;
                        signature = await conn.sendTransaction(tx, {
                            skipPreflight: Site.PRODUCTION,
                        });
                        setTimeout(async () => {
                            if (TokenEngine.#tokens[mint]) {
                                let token = TokenEngine.#tokens[mint];
                                const signIndex = TokenEngine.#signatures.indexOf(signature);
                                if (signIndex >= 0 || signCache.some(sign => TokenEngine.#signatures.includes(sign))) {
                                    // this trade was successful
                                    if (action == "sell" && amt == "100%" && Site.TRADE_AUTO_RECOVERY) {
                                        TokenEngine.recovery();
                                    }
                                }
                                else {
                                    // this trade was not successful after the timeout
                                    const mc = token.current_marketcap * (Site.BASE_DENOMINATED ? 1 : SolPrice.get());
                                    const mcValid = (mc >= Math.abs(marketcapLimit[0] || 0)) && (mc <= Math.abs(marketcapLimit[1] || Infinity));
                                    if (mcValid && retries > 0) {
                                        // conditions fulfilled
                                        const retried = await TokenEngine.#trade(action, mint, amt, (retries - 1), marketcapLimit, signCache.concat([signature]));
                                        if (retried.succ && Site.TRADE_SEND_RETRY_NOTIFICATION) {
                                            try {
                                                if (!TelegramEngine) {
                                                    TelegramEngine = require("./telegram");
                                                }
                                                TelegramEngine.sendMessage(`↩️ ${action.toUpperCase()} RETRY\n\n*${token.name} \\(${token.symbol}\\)*\nAmount 💰 ${action == "buy" ? Site.BASE : ""} ${amt}\nRetries Left 👍 ${(retries - 1)}\nSignature 🪧 \`${retried.message}\``);
                                            } catch (error) {
                                                Log.dev(error)
                                            }
                                        }
                                    }
                                }
                            }
                        }, Site.TRADE_RETRY_TIMEOUT_MS);
                        TokenEngine.successfulTx++;
                        resolve(new Res(true, signature));
                    } else {
                        resolve(new Res(false, response.statusText));
                    }
                } catch (error) {
                    Log.dev(error);
                    resolve(new Res(false, "SERVER"));
                }
            }
            else {
                resolve(new Res(false, "Whale Corrected Buy"));
            }
        });
    }
}

module.exports = TokenEngine;