const Site = require("../env");
const FFF = require("../lib/fff");
const formatNumber = require("../lib/format_number");
const getDateTime = require("../lib/get_date_time");
const getDateTime2 = require("../lib/get_date_time_2");
const getTimeElapsed = require("../lib/get_time_elapsed");
const Log = require("../lib/log");
const SolPrice = require("./sol_price");
const { Token } = require("./token_model");

let TokenEngine = null;
let TelegramEngine = null;
let SocketEngine = null;

class Whale {

    /**
     * @type {string}
     */
    trader;

    /**
     * @type {boolean}
     */
    isOG;

    /**
     * @type {number}
     */
    initialAmount;

    /**
     * @type {number}
     */
    total_buys;

    /**
     * @type {number}
     */
    total_sells;

    /**
     * @type {number}
     */
    currentAmount;

    /**
     * @type {number[]}
     */
    delta;

    /**
     * Object constructor
     * @param {any} data 
     * @param {boolean} isOG 
     */
    constructor(data, isOG) {
        const { trader, amount } = data;
        this.isOG = isOG;
        this.trader = trader;
        this.currentAmount = amount;
        this.initialAmount = amount;
        this.total_buys = 0;
        this.total_sells = 0;
        this.delta = [];
    }
}

/**
 * This class tracks the actions of top holders of a token
 */
class WhaleEngine {


    /**
     * Holds whale data for each token
     * @type {Record<string, Whale[]>}
     */
    static #data = {};

    /**
     * @type {boolean}
     */
    static useExit = Site.AU_AUTO_WHALE_EXIT;

    /**
     * @type {boolean}
     */
    static useEntry = Site.AU_AUTO_WHALE_ENTRY;

    /**
     * Holds Marketcap data for each toekn
     * @type {Record<string, number>}
     */
    static #MC = {};

    /**
     * Holds log of holder activity for each token
     * @type {Record<string, string[]>}
     */
    static #log = {};

    /**
     * Gets a token logs
     * @param {string} mint 
     * @returns {string[]}
     */
    static getLogs = (mint) => WhaleEngine.#log[mint] || [];

    /**
     * @type {Record<string, Set<string>>}
     */
    static #unloggedSelfActions = {};

    /**
     * Adds new self action
     * @param {string} mint 
     * @param {string} action 
     */
    static addSelfAction = (mint, action) => {
        if (WhaleEngine.#unloggedSelfActions[mint]) {
            WhaleEngine.#unloggedSelfActions[mint].add(action);
        }
    }

    /**
     * This method corrects entries based on configurations if enabled
     * @param {string} mint
     * @returns {boolean} - true for proceed, otherwise false 
     */
    static enter = (mint) => {
        if ((!WhaleEngine.#data[mint]) || (!WhaleEngine.useEntry)) {
            return true;
        }
        let conditionFulfilled = false;
        for (let i = 0; i < Site.AU_WHALE_ENTRY.length; i++) {
            const entry = Site.AU_WHALE_ENTRY[i];
            let c = WhaleEngine.#data[mint].slice(((entry.start || 1) - 1), ((entry.stop || WhaleEngine.#data[mint].length))).
                filter(whale => parseFloat((Math.min(100, Math.max(0, (((whale.initialAmount - whale.currentAmount) / whale.initialAmount) * 100))) || 0).toFixed(2)) >= entry.minSellPerc).
                length >= entry.minWhales;
            if (c) {
                conditionFulfilled = true;
                break;
            }
        }
        return (!(conditionFulfilled));
    }

    /**
     * Adds new token to be tracked
     * @param {string} mint 
     * @param {any[]} topHolders 
     */
    static newToken = (mint, topHolders) => {
        if (!WhaleEngine.#data[mint]) {
            WhaleEngine.#data[mint] = topHolders.slice(0, Site.WH_MAX_WHALES).map(data => (new Whale(data, true)));
            WhaleEngine.#log[mint] = [];
            WhaleEngine.#MC[mint] = 0;
            WhaleEngine.#unloggedSelfActions[mint] = new Set();
            const l = WhaleEngine.#data[mint].length;
            WhaleEngine.#log[mint].push(`${getDateTime2()} Initiated with ${l} whale${l == 1 ? "" : "s"}.`);
            Log.flow(`Whale > ${mint} added.`, 3);
            if (Site.UI) {
                if (!SocketEngine) {
                    SocketEngine = require("./socket");
                }
                SocketEngine.sendToken(mint, {
                    whaleLog: WhaleEngine.getLogs(mint).slice(-1),
                    whales: WhaleEngine.getForUI(mint),
                });
            }
        }
    }

    /**
     * Called when a new trade occurs on a monitored token
     * @param {any} message 
     */
    static newTrade = async (message) => {
        const { mint, traderPublicKey, txType, tokenAmount, solAmount, newTokenBalance, marketCapSol } = message;
        if (WhaleEngine.#data[mint] && ["buy", "sell"].indexOf(txType) >= 0 && traderPublicKey) {
            // Token is being monitored by engine
            const index = WhaleEngine.#data[mint].findIndex(x => x.trader == traderPublicKey);
            let actionTaken = false;
            const mc = parseFloat(marketCapSol) || WhaleEngine.#MC[mint] || 0;

            if (index >= 0) {
                const whale = WhaleEngine.#data[mint][index];
                if (whale.trader == traderPublicKey) {
                    // Action is carried out by a registered whale
                    let percChange = (newTokenBalance === 0 && txType == "sell") ? 100 : Math.abs(Math.max(-100, parseFloat((((tokenAmount / whale.currentAmount) * 100) || 0).toFixed(2))));
                    if (percChange === Infinity) {
                        percChange = 100;
                    }
                    if (percChange > 0) {
                        // action is tangible
                        const mcChange = WhaleEngine.#MC[mint] ? ` MC ${((mc - WhaleEngine.#MC[mint]) / WhaleEngine.#MC[mint] * 100).toFixed(2)}%.` : "";
                        const acts = (WhaleEngine.#unloggedSelfActions[mint] || (new Set())).size > 0 ? ` SA ${Array.from(WhaleEngine.#unloggedSelfActions[mint]).join(" ")}.` : "";
                        if (WhaleEngine.#unloggedSelfActions[mint]) {
                            WhaleEngine.#unloggedSelfActions[mint].clear();
                        }
                        /**
                         * @type {number}
                         */
                        const ca = newTokenBalance ?? (Math.max(0, (txType == "buy" ? (whale.currentAmount + tokenAmount) : (whale.currentAmount - tokenAmount))));
                        let percSold = parseFloat((Math.min(100, Math.max(0, (((whale.initialAmount - ca) / whale.initialAmount) * 100))) || 0).toFixed(2));
                        WhaleEngine.#log[mint].push(`${getDateTime2()} W${(index + 1)} ${txType == "buy" ? `bought ${percChange}% of current` : `sold ${percSold}% of initial`} amount.${mcChange}${acts}`);
                        if (txType == "buy") {
                            whale.total_buys += tokenAmount
                        }
                        else {
                            whale.total_sells += tokenAmount;
                        }
                        whale.currentAmount = ca;
                        whale.delta.push(txType == "buy" ? percChange : (-1 * percChange));
                        actionTaken = true;
                        if (Site.UI) {
                            if (!SocketEngine) {
                                SocketEngine = require("./socket");
                            }
                            SocketEngine.sendToken(mint, {
                                whaleLog: WhaleEngine.getLogs(mint).slice(-1),
                                whales: WhaleEngine.getForUI(mint),
                            });
                        }
                    }
                }
            }
            else {
                // Action is carried out by an unregistered holder
                // Check if amount qualifies trader to be a whale
                if (newTokenBalance) {
                    let n = WhaleEngine.#data[mint].length - 1;
                    let ind = -1;
                    while (n >= 0) {
                        if (WhaleEngine.#data[mint][n]) {
                            if (WhaleEngine.#data[mint][n].initialAmount < newTokenBalance) {
                                ind = n;
                            }
                            if (WhaleEngine.#data[mint][n].initialAmount > newTokenBalance) {
                                break;
                            }
                        }
                        n--;
                    }
                    if (ind >= 0) {
                        const mcChange = WhaleEngine.#MC[mint] ? ` MC ${((mc - WhaleEngine.#MC[mint]) / WhaleEngine.#MC[mint] * 100).toFixed(2)}%.` : "";
                        const acts = (WhaleEngine.#unloggedSelfActions[mint] || (new Set())).size > 0 ? ` SA ${Array.from(WhaleEngine.#unloggedSelfActions[mint]).join(" ")}.` : "";
                        if (WhaleEngine.#unloggedSelfActions[mint]) {
                            WhaleEngine.#unloggedSelfActions[mint].clear();
                        }
                        let replacedWhale = (WhaleEngine.#data[mint].length >= Site.WH_MAX_WHALES) ? WhaleEngine.#data[mint][ind] : null;
                        if (replacedWhale) {
                            replacedWhale = structuredClone(replacedWhale);
                        }
                        WhaleEngine.#data[mint].splice(ind, (WhaleEngine.#data[mint].length >= Site.WH_MAX_WHALES) ? 1 : 0, (new Whale({ trader: traderPublicKey, amount: newTokenBalance }, false)));
                        WhaleEngine.#log[mint].push(`${getDateTime2()} W${(ind + 1)} ${replacedWhale ? `is replaced.` : `is overtaken.`}${mcChange}${acts}`);
                        if (Site.UI) {
                            if (!SocketEngine) {
                                SocketEngine = require("./socket");
                            }
                            SocketEngine.sendToken(mint, {
                                whaleLog: WhaleEngine.getLogs(mint).slice(-1),
                                whales: WhaleEngine.getForUI(mint),
                            });
                        }
                        actionTaken = true;
                    }
                }
            }
            if (actionTaken) {
                if (WhaleEngine.#log[mint].length > Site.WH_MAX_LOGS) {
                    WhaleEngine.#log[mint] = WhaleEngine.#log[mint].slice(WhaleEngine.#log[mint].length - Site.WH_MAX_LOGS);
                }
                if (!TokenEngine) {
                    TokenEngine = require("./token");
                }
                /**
                 * @type {Token}
                 */
                let token = TokenEngine.getToken(mint);
                if (token && WhaleEngine.#data[mint]) {
                    if (token.amount_held > 0 && WhaleEngine.useExit && (!WhaleEngine.#exitExec[mint]) && ((token.source == "Kiko") || ((token.source == "Telegram") && (token.CSB) && (token.SLP)))) {
                        WhaleEngine.#exitExec[mint] = true;
                        for (let i = 0; i < Site.AU_WHALE_EXIT.length; i++) {
                            if (token.executed_whale_exits.indexOf(i) >= 0) {
                                continue;
                            }
                            const exit = Site.AU_WHALE_EXIT[i];
                            const pnl = token.pnl;
                            let c = (WhaleEngine.#data[mint].slice(((exit.start || 1) - 1), ((exit.stop || WhaleEngine.#data[mint].length))).
                                filter(whale => parseFloat((Math.min(100, Math.max(0, (((whale.initialAmount - whale.currentAmount) / whale.initialAmount) * 100))) || 0).toFixed(2)) >= exit.minSellPerc).
                                length >= exit.minWhales) && (pnl >= exit.minPnL) && (pnl <= exit.maxPnL);
                            if (c) {
                                // condition fulfilled for selling
                                const allocation = token.amount_held + 0;
                                const done = await TokenEngine.sell(mint, exit.sellPerc, `Whale ${(i + 1)}`, Site.TRADE_MAX_RETRIES_EXIT, [0, 0]);
                                if (done) {
                                    if (!TelegramEngine) {
                                        TelegramEngine = require("./telegram");
                                    }
                                    let msg = ``;
                                    if (Site.SIMULATION) {
                                        msg = `✅ *SELL*\n\nWhale Exit swapped ${token.symbol} ${FFF(((exit.sellPerc / 100) * allocation) || 0)} \\(${exit.sellPerc}%\\) to ${Site.BASE} ${FFF(done)} \\(USD ${FFF(done * SolPrice.get())}\\)\n\nMC 📈 ${Site.BASE} ${FFF(token.current_marketcap)} \\(USD ${FFF(token.current_marketcap * SolPrice.get())}\\)\nPrice 💰 ${Site.BASE} ${FFF(token.current_price)}\n`;
                                        TelegramEngine.sendMessage(msg);
                                    }
                                    else {
                                        msg = `✅ *SELL*\n\nWhale Exit executed on ${token.symbol}\n\n🪧 \`${done}\``;
                                        TelegramEngine.sendMessage(msg);
                                    }
                                    if (Site.UI && msg) {
                                        if (!SocketEngine) {
                                            SocketEngine = require("./socket");
                                        }
                                        SocketEngine.sendNote(msg);
                                    }
                                    token.executed_whale_exits.push(i);
                                    break;
                                }
                            }
                        }
                        delete WhaleEngine.#exitExec[mint];
                    }
                }
            }
            WhaleEngine.#MC[mint] = mc;
        }
    }

    /**
     * @type {Record<string, boolean>}
     */
    static #exitExec = {};

    /**
     * This removes a token from the engine and returns a telegram suited report
     * @param {string} mint 
     * @param {string} name
     * @param {string} symbol 
     * @returns {string}
     */
    static removeForTelegram = (mint, name, symbol) => {
        let m = ``;
        if ((!WhaleEngine.#data[mint]) || (!WhaleEngine.#log[mint]) || (!Site.TG_SEND_WHALE)) {
            return m;
        }

        m += `🐳 *Whale Analysis*\n\n💲 ${name} \\(${symbol}\\)\n\n`;
        // m += `\`\`\`\n${WhaleEngine.#data[mint].map((whale, i) => `W${(i + 1)}${whale.isOG ? `\\(OG\\)` : ``} 🔸 ${Math.max(-100, (((whale.currentAmount - whale.initialAmount) / whale.initialAmount) * 100)).toFixed(2)}% (D ${Math.round((whale.delta.reduce((a, b) => a + b, 0)) * 100) / 100}%)\n`).join("")}\`\`\`\n`;
        m += `\`\`\`\n${WhaleEngine.#data[mint].map((whale, i) => `W${(i + 1)}${whale.isOG ? `\\(OG\\)` : ``} 🔸 ${Math.max(-100, (((whale.currentAmount - whale.initialAmount) / whale.initialAmount) * 100)).toFixed(2)}%\n`).join("")}\`\`\`\n`;
        m += `\n*Whale Latest Logs*\n\`\`\`\n${WhaleEngine.#log[mint].map(x => `🔸 ${x}`).join("\n")}\`\`\``;
        Log.flow(`Whale > ${mint} removed.`, 3);
        delete WhaleEngine.#data[mint];
        delete WhaleEngine.#log[mint];
        delete WhaleEngine.#MC[mint];
        delete WhaleEngine.#unloggedSelfActions[mint];
        return m;
    }

    /**
     * This removes a token from the engine and returns a telegram suited report
     * @param {string} mint 
     * @returns {string}
     */
    static getForUI = (mint) => {
        let m = ``;
        if ((!WhaleEngine.#data[mint])) {
            return m;
        }
        m += `${WhaleEngine.#data[mint].map((whale, i) => `<span>W${(i + 1)}${whale.isOG ? `(OG)` : ``} 🔸 ${Math.max(-100, (((whale.currentAmount - whale.initialAmount) / whale.initialAmount) * 100)).toFixed(2)}%</span>`).join("")}`;
        return m;
    }
}

module.exports = { WhaleEngine, Whale };