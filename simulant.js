const arg = process.argv.slice(2);
if (arg.length && arg[0] == "nc") {
    process.argv.splice(2, 0, ".env");
}
const Log = require("./lib/log");
const fs = require("fs");
const path = require("path");
const rootDir = require("./root");
const Site = require("./env");
const { get } = require("./lib/make_request");
const getTimeElapsed = require("./lib/get_time_elapsed");
const { OHLCV, LimitOrder } = require("./engine/token_model");
const CandlestickEngine = require("./engine/candlestick");
const FFF = require("./lib/fff");
const getDateTime = require("./lib/get_date_time");
const formatNumber = require("./lib/format_number");
const html_to_pdf = require('html-pdf-node');
const useCache = arg[0] != "nc";

const tc = str => str.replace(/\w\S*/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase());

class Trade {
    /**
     * @type {number}
     */
    capital;

    /**
     * @type {number}
     */
    roc;

    /**
     * @type {number}
     */
    amount;

    /**
     * @type {number}
     */
    buyPrice;

    /**
     * @type {number}
     */
    pnlBase;

    /**
     * @type {number}
     */
    pnl;

    /**
     * @type {number}
     */
    maxPnL;

    /**
     * @type {number}
     */
    minPnL;

    /**
     * @type {LimitOrder[]}
     */
    pendingOrders;

    /**
     * @type {number[]}
     */
    executed_peak_drops;

    /**
     * @type {number}
     */
    signalIndex;

    /**
     * @type {number}
     */
    markPrice;

    /**
     * @type {number}
     */
    slPrice;

    /**
     * @type {number}
     */
    cycles;

    /**
     * @type {string[]}
     */
    entryReasons;

    /**
     * @type {string[]}
     */
    exitReasons;

    constructor() {
        this.pendingOrders = [];
        this.executed_peak_drops = [];
        this.pnlBase = 0;
        this.pnl = 0;
        this.maxPnL = 0;
        this.minPnL = 0;
        this.roc = 0;
        this.entryReasons = [];
        this.exitReasons = [];
        this.markPrice = 0;
        this.slPrice = 0;
        this.cycles = 0;
    }
}

class ExecReport {
    /**
     * @type {'serial'|'standalone'}
     */
    name;

    /**
     * @type {number}
     */
    totalTrades;

    /**
     * @type {number}
     */
    concludedTrades

    /**
     * @type {Trade[]}
     */
    trades;

    /**
     * @type {number}
     */
    realizedPnLBase;

    /**
    * @type {number}
    */
    totalGains;

    /**
    * @type {number}
    */
    totalLosses;

    /**
     * Object constructor
     * @param {'serial'|'standalone'} name 
     * @param {Trade[]} trades 
     */
    constructor(name, trades) {
        this.name = name;
        this.trades = structuredClone(trades);
        this.realizedPnLBase = 0;
        this.totalTrades = trades.length;
        this.concludedTrades = 0;
        this.totalGains = 0;
        this.totalLosses = 0;
    }
}

/**
 * Standalonr script to simulate current strategy on historical data.
 * Only for candlestick analysis and automation.
 */
Site.PRODUCTION = true;
Site.MAX_FLOW_LOG_WEIGHT = 1;
class Simulant {

    static #cacheId = `SIM_${Site.SIM_TOTAL_ROWS}_${Site.SIM_ANALYSIS_ROWS}_${Site.SIM_INTERVAL_MS}`;

    /**
     * @type {Record<string,Record<string, any>>}
     */
    static #cache = {};

    static #persPth = path.resolve(rootDir(), "simulant");

    static #cachePth = path.resolve(Simulant.#persPth, "cache.json");
    static #colPth = path.resolve(Simulant.#persPth, "col_data.json");
    static #repPth = path.resolve(Simulant.#persPth, "report.pdf");

    /**
     * @type {Record<string, Record<string>[]>};
     */
    static #colData = {}

    /**
     * @type {string}
     */
    static #report = ``;

    /**
     * Script initialzizer.
     * @returns {Promise<boolean>}
     */
    static #start = () => {
        return new Promise((resolve, reject) => {
            // Log.flow(`Simulant > Cache > Recovering...`, 0);
            Log.flow(`Simulant > Running prerequisites.`, 0);
            try {
                if (!fs.existsSync(Simulant.#persPth)) {
                    fs.mkdirSync(Simulant.#persPth);
                    Log.flow(`Simulant > Created directory at '${Simulant.#persPth}'.`, 0);
                }
                if (fs.existsSync(Simulant.#cachePth)) {
                    Log.flow(`Simulant > Cache file found at '${Simulant.#cachePth}'.`, 0);
                    Simulant.#cache = JSON.parse(fs.readFileSync(Simulant.#cachePth, "utf8"));
                    resolve(true);
                }
                else {
                    Log.flow(`Simulant > No cache found.`, 0);
                    resolve(true);
                }
            } catch (error) {
                Log.flow(`Simulant > Error encountered ${error.message ? `${error.message}` : ''}.`, 0);
                Log.dev(error);
                resolve(false);
            }
        });
    }

    /**
     * Script destructor.
     * @returns {Promise<boolean>}
     */
    static #stop = () => {
        return new Promise((resolve, reject) => {
            // Log.flow(`Simulant > Cache > Recovering...`, 0);
            Log.flow(`Simulant > Running post-sctipts.`, 0);
            try {
                fs.writeFileSync(Simulant.#cachePth, JSON.stringify(Simulant.#cache), "utf8");
                Log.flow(`Simulant > Saved cache to '${Simulant.#cachePth}'.`, 0);
                fs.writeFileSync(Simulant.#colPth, JSON.stringify(Simulant.#colData, null, "\t"), "utf8");
                Log.flow(`Simulant > Saved collector data to '${Simulant.#colPth}'.`, 0);
                let temp = console.log;
                console.log = () => {}
                html_to_pdf.generatePdf({ content: Simulant.#report }, {
                    format: "A4",
                    margin: {
                        bottom: '10px',
                        top: '10px',
                        left: '0px',
                        right: '0px',
                    },
                    printBackground: true,
                }).then(pdfBuffer => {
                    console.log = temp;
                    fs.writeFileSync(`${Simulant.#repPth}`, pdfBuffer);
                    Log.flow(`Simulant > Saved report to '${Simulant.#repPth}'.`, 0);
                    resolve(true);
                });
            } catch (error) {
                Log.flow(`Simulant > Error encountered ${error.message ? `${error.message}` : ''}.`, 0);
                Log.dev(error);
                resolve(false);
            }
        })
    }

    /**
     * Ensures data is available for a token
     * @param {string} mint 
     * @returns {Promise<any>}
     */
    static #fetchData = (mint) => {
        return new Promise(async (resolve, reject) => {
            let cachedData = (Simulant.#cache[Simulant.#cacheId] || {})[mint];
            if (cachedData && useCache) {
                Log.flow(`Simulant > Cached data found for ${mint}.`, 0);
                resolve(cachedData);
            }
            else {
                Log.flow(`Simulant > Cached data not found for ${mint}. Fetching metadata.`, 0);
                const getMetadata = (mint) => new Promise((resolve, reject) => {
                    get(`${Site.PF_API}/coins/${mint}`, r => {
                        if (r.succ) {
                            if (r.message.name && r.message.symbol) {
                                resolve(r.message);
                            }
                            else {
                                resolve(null);
                            }
                        }
                        else {
                            resolve(null);
                        }
                    });
                });

                const obj = await getMetadata(mint);
                if (obj) {
                    Log.flow(`Simulant > Fetched metadata for ${mint}. Fetching candlestick data.`, 0);
                    const { name, symbol, description, pump_swap_pool } = obj;
                    const pool = pump_swap_pool;
                    let valid = false;
                    let interval = "";
                    let url = "";
                    if (pool) {
                        interval = getTimeElapsed(0, Site.SIM_INTERVAL_MS);
                        valid = ["1s", "15s", "30s", "1m", "5m", "15m", "30m", "1h", "4h", "6h", "12h", "24h"].indexOf(interval) >= 0;
                        url = `https://swap-api.pump.fun/v1/pools/${pool}/candles?interval=${interval}&limit=${Site.SIM_TOTAL_ROWS}&currency=${Site.BASE}`;
                    }
                    else {
                        interval = Site.SIM_INTERVAL_MS == 60000 ? 1 : 5;
                        valid = Site.SIM_INTERVAL_MS == 60000 || Site.SIM_INTERVAL_MS == 300000;
                        url = `${Site.PF_API}/candlesticks/${mint}/?offset=0&timeframe=${interval}&limit=${Site.SIM_TOTAL_ROWS}`;
                    }
                    if (valid) {
                        get(url, r => {
                            if (r.succ ? (Array.isArray(r.message)) : false) {
                                /**
                                 * @type {any[]}
                                 */
                                let m = r.message;
                                if (pool) {
                                    m = m.map(x => new OHLCV(
                                        parseFloat(x.open) || 0,
                                        parseFloat(x.high) || 0,
                                        parseFloat(x.low) || 0,
                                        parseFloat(x.close) || 0,
                                        parseFloat(x.volume) || 0,
                                    ))
                                }
                                else {
                                    m = m.filter(x => (x.is_1_min && Site.SIM_INTERVAL_MS == 60000) || (x.is_5_min && Site.SIM_INTERVAL_MS == 300000)).map(x =>
                                        new OHLCV(
                                            parseFloat(x.open) || 0,
                                            parseFloat(x.high) || 0,
                                            parseFloat(x.low) || 0,
                                            parseFloat(x.close) || 0,
                                            parseFloat(x.volume) || 0,
                                        )
                                    );
                                }
                                if (!Simulant.#cache[Simulant.#cacheId]) {
                                    Simulant.#cache[Simulant.#cacheId] = {};
                                }
                                let obj2 = { ...obj, candlestick: m };
                                if (!Simulant.#cache[Simulant.#cacheId][mint]) {
                                    Simulant.#cache[Simulant.#cacheId][mint] = obj2;
                                }
                                const l = m.length;
                                Log.flow(`Simulant > Fetched ${l} row${l == 1 ? "" : "s"} of historical candlestick data at ${interval} interval for ${mint}.`, 5);
                                resolve(obj2);
                            }
                            else {
                                Log.flow(`Simulant > Error fetching candlestick data for ${mint}.`, 0);
                                resolve(null);
                            }
                        });
                    }
                    else {
                        Log.flow(`Simulant > ${mint}'s pool is not compatible with configured interval.`, 0);
                        resolve(null);
                    }
                }
                else {
                    Log.flow(`Simulant > Could not fetch metadata for ${mint}.`, 0);
                    resolve(null);
                }
            }
        });
    }

    /**
     * Activation method
     */
    static run = async () => {
        Log.flow(`Simulant > Initialized.`, 0);
        if (Site.SIM_TOKENS.length) {
            const started = await Simulant.#start();
            if (started) {
                Log.flow(`Simulant > Done running prerequisites.`, 0);
                /**
                 * @type {Record<string, ExecReport[]>}
                 */
                let rep = {};
                for (const mint of Site.SIM_TOKENS) {
                    Log.flow(`Simulant > Fetching data for ${mint}.`, 0);
                    const data = await Simulant.#fetchData(mint);
                    if (data) {
                        const { name, symbol, candlestick } = data;
                        /**
                         * @type {OHLCV[]}
                         */
                        let csd = candlestick;
                        if (csd.length <= Site.SIM_ANALYSIS_ROWS) {
                            Log.flow(`Simulant > ${name} > Not enough row for analysis.`, 0);
                        }
                        else {
                            Log.flow(`Simulant > ${name} > Running analysis...`, 0);
                            /**
                             * @type {Trade[]}
                             */
                            let trades = [];
                            for (let i = (Site.SIM_ANALYSIS_ROWS - 1); i < csd.length; i++) {
                                // let csdPart = csd.slice((i + 1 - Site.SIM_ANALYSIS_ROWS), (i + 1));
                                let csdPart = csd.slice(0, (i + 1));
                                if (csdPart.length > Site.SIM_ANALYSIS_ROWS_MAX) {
                                    csdPart = csdPart.slice(csdPart.length - Site.SIM_ANALYSIS_ROWS_MAX)
                                }
                                const res = await CandlestickEngine.entry(name, mint, csdPart);
                                const { rate, signal, buy, sell, sl, desc } = res;
                                if (!Simulant.#colData[mint]) {
                                    Simulant.#colData[mint] = [];
                                }
                                Simulant.#colData[mint].push(res);
                                // SIMULATE TRADING
                                if (buy) {
                                    // Entry signal detected
                                    let t = new Trade();
                                    t.amount = Site.CSBUY_AMT_BASE / rate;
                                    t.capital = Site.CSBUY_AMT_BASE;
                                    t.markPrice = rate;
                                    t.slPrice = sl;
                                    let buyPrice = rate;
                                    let slPerc = Math.abs((((sl - rate) / rate) * 100) || 0);
                                    let min = Site.CSBUY_ALLOWED_SL_PERC_RANGE[0] || 0;
                                    let max = Site.CSBUY_ALLOWED_SL_PERC_RANGE[1] || Infinity;
                                    let PnL = 0;
                                    t.entryReasons.push(`CSB ${desc}`);
                                    let maxPnL = 0;
                                    let minPnL = 0;
                                    if (slPerc < min) {
                                        slPerc = min;
                                    }
                                    if (slPerc > max) {
                                        slPerc = max;
                                    }
                                    slPerc = slPerc * -1;
                                    let slPrice = ((slPerc * buyPrice) / 100) + buyPrice;
                                    // REGISTER STOP LOSS
                                    if (Site.CSBUY_PSAR_SL) {
                                        let o = new LimitOrder();
                                        o.amount = Site.CSBUY_PSAR_SL;
                                        o.type = "sell";
                                        o.marketcap = slPrice * -1;
                                        t.pendingOrders.push(o);
                                    }
                                    // REGISTER AUTO SELLS
                                    for (const autoSell of Site.CSBUY_SELL) {
                                        let sellPrice = ((autoSell.pnl * buyPrice) / 100) + buyPrice;
                                        let o = new LimitOrder();
                                        o.amount = autoSell.perc;
                                        o.type = "sell";
                                        o.marketcap = sellPrice * (autoSell.pnl > 0 ? 1 : -1);
                                        if (autoSell.trailing) {
                                            o.perc = autoSell.pnl;
                                            o.min_sell_pnl = autoSell.minPnL;
                                            o.max_sell_pnl = autoSell.maxPnL;
                                            o.trailing = true;
                                        }
                                        t.pendingOrders.push(o);
                                    }

                                    t.buyPrice = rate;
                                    t.signalIndex = i;

                                    trades.push(t);
                                }
                            }
                            /**
                             * @type {ExecReport[]}
                             */
                            let reports = [];
                            for (const ty of Site.SIM_EXECS) {
                                reports.push(new ExecReport(ty, trades));
                            }
                            // RUNTIME 
                            for (const report of reports) {
                                if (report.name == "serial") {
                                    // SERIAL EXECUTION - TRADES ARE DEPENDENT ON THEIR PREDECESSORS
                                    let startingIndex = 0;
                                    for (let a = 0; a < csd.length; a++) {
                                        let row = csd[a];
                                        let trade = report.trades.filter(t => t.amount > 0 && t.signalIndex >= startingIndex)[0];
                                        if (trade ? (trade.signalIndex <= a) : false) {
                                            // A trade is available
                                            // Update PnL data
                                            let rate = Site.SIM_EXEC_USE_HIGH_FOR_RATE ? row.high : row.close;
                                            let roi = trade.roc + (trade.amount * rate);
                                            trade.pnlBase = roi - trade.capital;
                                            trade.pnl = trade.pnlBase / trade.capital * 100;
                                            if (trade.pnl > trade.maxPnL) {
                                                // Update trailing stop losses
                                                for (let b = 0; b < trade.pendingOrders.length; b++) {
                                                    let order = trade.pendingOrders[b];
                                                    if (order.trailing) {
                                                        order.marketcap = ((((order.perc * rate) / 100) + rate) * -1);
                                                    }
                                                }
                                                trade.maxPnL = trade.pnl;
                                            }
                                            if (trade.pnl < trade.minPnL) {
                                                trade.minPnL = trade.pnl;
                                            }
                                            // console.log(trade.minPnL, trade.pnl, trade.maxPnL);
                                            // Execute Limit orders
                                            for (let c = 0; c < trade.pendingOrders.length; c++) {
                                                let order = trade.pendingOrders[c];
                                                const sufficient = (trade.amount > 0 && order.type == "sell") || order.type == "buy";
                                                const allocation = trade.amount + 0;
                                                if (order.type == "sell" && order.marketcap < 0) {
                                                    // less than or equal to
                                                    if (rate <= Math.abs(order.marketcap) && sufficient && (order.trailing ? ((trade.pnl >= order.min_sell_pnl) && (trade.pnl <= order.max_sell_pnl)) : true)) {
                                                        // condition for this order has been fulfilled
                                                        let amtToSell = (order.amount / 100) * trade.amount;
                                                        let baseValue = amtToSell * rate;
                                                        trade.roc += baseValue;
                                                        trade.amount -= amtToSell;
                                                        trade.exitReasons.push(`${order.trailing ? `TSL` : `Limit`} < ${FFF(Math.abs(order.marketcap))}`);
                                                        trade.pendingOrders.splice(c, 1);
                                                        c--;
                                                        break;
                                                    }
                                                }
                                                else if (order.type == "sell" && order.marketcap > 0) {
                                                    // greater than or equal to
                                                    if (rate >= Math.abs(order.marketcap) && sufficient) {
                                                        // condition for this order has been fulfilled
                                                        let amtToSell = (order.amount / 100) * trade.amount;
                                                        let baseValue = amtToSell * rate;
                                                        trade.roc += baseValue;
                                                        trade.amount -= amtToSell;
                                                        trade.exitReasons.push(`${order.trailing ? `TSL` : `Limit`} > ${FFF(Math.abs(order.marketcap))}`);
                                                        trade.pendingOrders.splice(c, 1);
                                                        c--;
                                                        break;
                                                    }
                                                }
                                            }
                                            // Execute Peak Drops
                                            if (trade.amount > 0) {
                                                for (let d = 0; d < Site.AU_PEAKDROP.length; d++) {
                                                    if (trade.executed_peak_drops.indexOf(d) >= 0) {
                                                        continue;
                                                    }
                                                    const pd = Site.AU_PEAKDROP[d];
                                                    const pnl = trade.pnl;
                                                    const maxPnl = trade.maxPnL;
                                                    const allocation = trade.amount + 0;
                                                    const drop = maxPnl - pnl;
                                                    const reached = pnl >= pd.minPnLPerc && (pd.maxPnLPerc ? (pnl <= pd.maxPnLPerc) : true) && drop >= pd.minDropPerc;
                                                    if (reached) {
                                                        let amtToSell = (pd.sellPerc / 100) * trade.amount;
                                                        let baseValue = amtToSell * rate;
                                                        trade.roc += baseValue;
                                                        trade.amount -= amtToSell;
                                                        trade.exitReasons.push(`Peak Drop ${drop.toFixed(2)}%`);
                                                        trade.executed_peak_drops.push(d);
                                                        break;
                                                    }
                                                }
                                            }
                                            // finish up
                                            if (trade.amount <= 0) {
                                                startingIndex = a;
                                                trade.cycles = a - trade.signalIndex + 1;
                                            }
                                        }
                                    }
                                }
                                if (report.name == "standalone") {
                                    // STANDALONE EXECUTION - EACH TRADE EXECUTES INDEPENDENT OF ANOTHER TRADE
                                    for (const trade of report.trades) {
                                        for (let a = trade.signalIndex; a < csd.length; a++) {
                                            let row = csd[a];
                                            if (trade ? (trade.signalIndex <= a) : false) {
                                                // A trade is available
                                                // Update PnL data
                                                let rate = Site.SIM_EXEC_USE_HIGH_FOR_RATE ? row.high : row.close;
                                                let roi = trade.roc + (trade.amount * rate);
                                                trade.pnlBase = roi - trade.capital;
                                                trade.pnl = trade.pnlBase / trade.capital * 100;
                                                if (trade.pnl > trade.maxPnL) {
                                                    // Update trailing stop losses
                                                    for (let b = 0; b < trade.pendingOrders.length; b++) {
                                                        let order = trade.pendingOrders[b];
                                                        if (order.trailing) {
                                                            order.marketcap = ((((order.perc * rate) / 100) + rate) * -1);
                                                        }
                                                    }
                                                    trade.maxPnL = trade.pnl;
                                                }
                                                if (trade.pnl < trade.minPnL) {
                                                    trade.minPnL = trade.pnl;
                                                }
                                                // console.log(trade.minPnL, trade.pnl, trade.maxPnL);
                                                // Execute Limit orders
                                                for (let c = 0; c < trade.pendingOrders.length; c++) {
                                                    let order = trade.pendingOrders[c];
                                                    const sufficient = (trade.amount > 0 && order.type == "sell") || order.type == "buy";
                                                    const allocation = trade.amount + 0;
                                                    if (order.type == "sell" && order.marketcap < 0) {
                                                        // less than or equal to
                                                        if (rate <= Math.abs(order.marketcap) && sufficient && (order.trailing ? ((trade.pnl >= order.min_sell_pnl) && (trade.pnl <= order.max_sell_pnl)) : true)) {
                                                            // condition for this order has been fulfilled
                                                            let amtToSell = (order.amount / 100) * trade.amount;
                                                            let baseValue = amtToSell * rate;
                                                            trade.roc += baseValue;
                                                            trade.amount -= amtToSell;
                                                            trade.exitReasons.push(`${order.trailing ? `TSL` : `Limit`} < ${FFF(Math.abs(order.marketcap))}`);
                                                            trade.pendingOrders.splice(c, 1);
                                                            c--;
                                                            break;
                                                        }
                                                    }
                                                    else if (order.type == "sell" && order.marketcap > 0) {
                                                        // greater than or equal to
                                                        if (rate >= Math.abs(order.marketcap) && sufficient) {
                                                            // condition for this order has been fulfilled
                                                            let amtToSell = (order.amount / 100) * trade.amount;
                                                            let baseValue = amtToSell * rate;
                                                            trade.roc += baseValue;
                                                            trade.amount -= amtToSell;
                                                            trade.exitReasons.push(`${order.trailing ? `TSL` : `Limit`} > ${FFF(Math.abs(order.marketcap))}`);
                                                            trade.pendingOrders.splice(c, 1);
                                                            c--;
                                                            break;
                                                        }
                                                    }
                                                }
                                                // Execute Peak Drops
                                                if (trade.amount > 0) {
                                                    for (let d = 0; d < Site.AU_PEAKDROP.length; d++) {
                                                        if (trade.executed_peak_drops.indexOf(d) >= 0) {
                                                            continue;
                                                        }
                                                        const pd = Site.AU_PEAKDROP[d];
                                                        const pnl = trade.pnl;
                                                        const maxPnl = trade.maxPnL;
                                                        const allocation = trade.amount + 0;
                                                        const drop = maxPnl - pnl;
                                                        const reached = pnl >= pd.minPnLPerc && (pd.maxPnLPerc ? (pnl <= pd.maxPnLPerc) : true) && drop >= pd.minDropPerc;
                                                        if (reached) {
                                                            let amtToSell = (pd.sellPerc / 100) * trade.amount;
                                                            let baseValue = amtToSell * rate;
                                                            trade.roc += baseValue;
                                                            trade.amount -= amtToSell;
                                                            trade.exitReasons.push(`Peak Drop ${drop.toFixed(2)}%`);
                                                            trade.executed_peak_drops.push(d);
                                                            break;
                                                        }
                                                    }
                                                }
                                                // finish up
                                                if (trade.amount <= 0) {
                                                    trade.cycles = a - trade.signalIndex + 1;
                                                    break;
                                                }
                                            }
                                        }
                                    }
                                }
                                report.trades = report.trades.filter(x => x.amount <= 0);
                                report.trades = report.trades.map(x => ({ ...x, pendingOrders: x.pendingOrders.length, entryReasons: x.entryReasons.join(" | "), exitReasons: x.exitReasons.join(" | ") }));
                                report.concludedTrades = report.trades.length;
                                report.realizedPnLBase = report.trades.map(x => x.pnlBase).reduce((a, b) => a + b, 0);
                                report.totalGains = report.trades.filter(x => x.pnlBase > 0).map(x => x.pnlBase).reduce((a, b) => a + b, 0);
                                report.totalLosses = report.trades.filter(x => x.pnlBase < 0).map(x => x.pnlBase).reduce((a, b) => a + b, 0);
                                report.trades.sort((a, b) => b.pnl - a.pnl);
                            }
                            rep[`${name} (${symbol})`] = reports;
                        }
                    }
                }

                Simulant.#report = `
                <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Report - ${getDateTime()}</title>
                    <style>
                        *{box-sizing: border-box;outline: none;}
                        body{margin: 0px;padding:10px 10px;font-family: Arial, Helvetica, sans-serif;font-size:80%;}
                        h1{margin: 50px 0px;}
                        h1, h2{text-align:center;}
                        .report{border: 1px solid transparent; padding: 10px; margin-bottom: 10px; width: 100%;background-color: #eeeeee;}
                        table{width: 100%; }
                        .attr-tab{
                            max-width: 500px;
                        }
                        .attr-tab, .attr-tab tr, .attr-tab tr th, .attr-tab tr td{border: 1px solid transparent; border-collapse: collapse;}
                        .attr-tab tr th, .attr-tab tr td{text-align: left; padding: 10px;}
                        .trade-tab, .trade-tab tr, .trade-tab tr th, .trade-tab tr td{border: 1px solid transparent; border-collapse: collapse;}
                        .trade-tab tr th, .trade-tab tr td{text-align: left; padding: 10px;}
                        .trade-tab tr:nth-child(even) {background-color: #ffffff;}
                        h3, h4{padding-left: 10px;}
                        .container{width: 100%; overflow:hidden;max-width:1700px;margin:0px auto;}
                    </style>
                </head>
                <body>
                    <div class="container">
                    <h1>Simulation Report - ${getDateTime()}</h1>
                    <div class="report">
                    <table class="attr-tab">
                        <tr>
                            <th>Capital/Trade</th>
                            <td>${Site.BASE} ${FFF(Site.CSBUY_AMT_BASE)}</td>
                        </tr>
                        <tr>
                            <th>Interval</th>
                            <td>${getTimeElapsed(0, Site.SIM_INTERVAL_MS)}</td>
                        </tr>
                        <tr>
                            <th>Total Rows/Token</th>
                            <td>${formatNumber(Site.SIM_TOTAL_ROWS)}</td>
                        </tr>
                        <tr>
                            <th>Analysis Rows/Token (Max)</th>
                            <td>${formatNumber(Site.SIM_ANALYSIS_ROWS)} (${formatNumber(Site.SIM_ANALYSIS_ROWS_MAX)})</td>
                        </tr>
                        <tr>
                            <th>Candlestick Mark Price</th>
                            <td>${tc(Site.SIM_EXEC_USE_HIGH_FOR_RATE ? 'high' : 'close')}</td>
                        </tr>
                    </table>
                    </div>
                    <br><br>
                    ${Object.keys(rep).map((r, i) => `
                    <h2>${r}</h2>
                    ${rep[r].map((rr) => `
                    <div class="report">
                        <h3>${tc(rr.name)}</h3>
                        <table class="attr-tab">
                            <tr>
                                <th>Completed Trades</th>
                                <td>${formatNumber(rr.concludedTrades)} / ${formatNumber(rr.totalTrades)} (${formatNumber(rr.trades.filter(x => x.pnl > 0).length)} gained, ${formatNumber(rr.trades.filter(x => x.pnl < 0).length)} lost)</td>
                            </tr>
                            <tr>
                                <th>Total Gain</th>
                                <td>${Site.BASE} ${FFF(rr.totalGains)}</td>
                            </tr>
                            <tr>
                                <th>Total Loss</th>
                                <td>${Site.BASE} ${FFF(rr.totalLosses)}</td>
                            </tr>
                            <tr>
                                <th>PnL</th>
                                <td>${Site.BASE} ${FFF(rr.realizedPnLBase)}</td>
                            </tr>
                        </table>
                        ${(rr.trades.length > 0 && Site.SIM_REPORT_INCLUDE_TRADES) ? `
                        <h4>Completed Trades</h4>
                        <table class="trade-tab">
                            <tr>
                                <th>Mark Price</th>
                                <th>SL Price</th>
                                <th>Comp. Cycles</th>
                                <th>Entry Remark</th>
                                <th>Exit Remark</th>
                                <th>PnL</th>
                                <th>Max. PnL</th>
                                <th>Min. PnL</th>
                                <th>Pending L.O.'s</th>
                            </tr>
                            ${rr.trades.map((trade) => `
                            <tr>
                                <td>${FFF(trade.markPrice)}</td>
                                <td>${FFF(trade.slPrice)} (${(((trade.slPrice - trade.markPrice) / trade.markPrice * 100) || 0).toFixed(2)}%)</td>
                                <td>${formatNumber(trade.cycles)}</td>
                                <td>${tc(trade.entryReasons)}</td>
                                <td>${tc(trade.exitReasons)}</td>
                                <td>${(Math.round(trade.pnl * 100) / 100)}%</td>
                                <td>${(Math.round(trade.maxPnL * 100) / 100)}%</td>
                                <td>${(Math.round(trade.minPnL * 100) / 100)}%</td>
                                <td>${formatNumber(trade.pendingOrders)}</td>
                            </tr>
                            `).join("\n")}
                        </table>
                        ` : ``}
                    </div>
                    `).join("\n")}
                    ${(i < (Object.keys(rep).length - 1)) ? `<br><br><br>` : ''}
                    `).join("\n")
                    }
                    </div>
                </body>
                </html>
                `;
                await Simulant.#stop();
            }
            else {
                Log.flow(`Simulant > Script failed to start.`, 0);
            }
        }
        else {
            Log.flow(`Simulant > No tokens found.`, 0);
        }
    }
}

Simulant.run();