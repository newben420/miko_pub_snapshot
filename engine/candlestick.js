const Site = require("../env");
const fs = Site.IND_ML_COLLECT_DATA ? require("fs") : {};
const booleanThreshold = require("../lib/boolean_threshold");
const { compute1ExpDirection, compute2ExpDirection, computeArithmeticDirection, clearDirection } = require("../lib/direction");
const {
    MACD, PSAR, Stochastic, bullish, bearish, VWAP, ADL, ATR, AwesomeOscillator, ROC, ForceIndex,
    TRIX, ADX, BollingerBands, CCI, MFI, RSI, abandonedbaby, bearishengulfingpattern, darkcloudcover,
    piercingline, eveningstar, eveningdojistar, threeblackcrows, gravestonedoji, bearishharami, bearishmarubozu,
    tweezertop, hangingman, shootingstar, bearishharamicross, morningstar, threewhitesoldiers, bullishengulfingpattern,
    morningdojistar, hammerpattern, dragonflydoji, bullishharami, bullishmarubozu, bullishharamicross, tweezerbottom,
} = require("technicalindicators");
const Log = require("../lib/log");
const SignalManager = require("./signal_manager");
const FFF = require("../lib/fff");
const calculateUtf8FileSize = require("../lib/file_size");
const getDateTime = require("../lib/get_date_time");
let CSBuy = null;
let TelegramEngine = null;


class Decision {
    /**
     * Whether to buy or not
     * @type {boolean}
     */
    buy;

    /**
     * Whether to sell or not
     * @type {boolean}
     */
    sell;

    /**
     * Class constructor
     * @param {boolean} buy 
     * @param {boolean} sell 
     */
    constructor(buy = false, sell = false) {
        this.buy = buy;
        this.sell = sell;
    }
}

class SignalGraph {
    /**
     * Current rate
     * @type {number}
     */
    rate;

    /**
     * Signal history
     * @type {string[]}
     */
    signals;

    /**
     * Latest epoch timestamp as an identifier for the signal group
     */
    ts;

    /**
     * Class constructor
     */
    constructor() {
        this.rate = 0;
        this.signals = [];
        this.ts = Date.now();
    }
}

class CandlestickEngine {

    /**
     * Holds previous PSAR Bull/Bear values for a token
     * @type {Record<string, boolean[]>}
     */
    static #isBull = {};

    /**
     * Called when a token is deleted from token engine so its data can be cleared here as well
     * @param {string} mint 
     */
    static removeToken = (mint) => {
        delete CandlestickEngine.#isBull[mint];
        delete CandlestickEngine.#latestDecisions[mint];
        delete CandlestickEngine.#signals[mint];
        delete CandlestickEngine.#signalHistory[mint];
        delete CandlestickEngine.#emitTS[mint];
    }

    /**
     * Keeps timestamp of the last time a signal was emitted for a token
     * @type {Record<string, number>}
     */
    static #emitTS = {};

    /**
     * Handles candlestick data anaylsis
     * @param {string} name 
     * @param {string} mint 
     * @param {any[]} data 
     */
    static entry = (name, mint, data) => {
        if (data.length >= Site.IND_MIN_LENGTH) {
            const ts = Date.now();
            /**
             * @type {number[]}
             */
            const open = data.map(x => x.open);
            /**
            * @type {number[]}
            */
            const high = data.map(x => x.high);
            /**
            * @type {number[]}
            */
            const low = data.map(x => x.low);
            /**
            * @type {number[]}
            */
            const close = data.map(x => x.close);
            /**
            * @type {number[]}
            */
            const volume = data.map(x => x.volume);

            const latestRate = close[close.length - 1];

            Log.flow(`CE > ${name} > Begin iteration.`, 6);

            if (!CandlestickEngine.#isBull[mint]) {
                CandlestickEngine.#isBull[mint] = [];
            }

            const psar = PSAR.calculate({ high, low, step: Site.IND_PSAR_STEP, max: Site.IND_PSAR_MAX });
            const psarBull = (psar[psar.length - 1] ?? latestRate) < latestRate;
            const psarBear = (psar[psar.length - 1] ?? latestRate) > latestRate;
            const csd = { open, close, high, low };
            const dirLength = Math.min(Site.IND_DIR_LENGTH, data.length);

            if (psarBear) {
                CandlestickEngine.#isBull[mint].push(false);
            }
            else if (psarBull) {
                CandlestickEngine.#isBull[mint].push(true);
            }

            if (CandlestickEngine.#isBull[mint].length > Site.IND_DIR_LENGTH) {
                CandlestickEngine.#isBull[mint] = CandlestickEngine.#isBull[mint].slice(CandlestickEngine.#isBull[mint].length - Site.IND_DIR_LENGTH);
            }

            let buy = false;
            let sell = false;
            let desc = "No Signal";
            let stopLossPrice = psar[psar.length - 1] || 0;

            if (CandlestickEngine.#isBull[mint].length >= 2) {
                // Enough outputs have been made
                let recent = CandlestickEngine.#isBull[mint][CandlestickEngine.#isBull[mint].length - 1];
                let second = CandlestickEngine.#isBull[mint][CandlestickEngine.#isBull[mint].length - 2];
                if ((!second) && recent) {
                    // Entry point detected
                    Log.flow(`CE > ${name} > Entry detected. Using ${Site.IND_MACD_FOR_TREND ? "MACD" : "Bullish Function"} for trend.`, 6);
                    /**
                     * @type {boolean}
                     */
                    let bull = false;
                    if (Site.IND_MACD_FOR_TREND) {
                        Log.flow(`CE > ${name} > Entry detected.`, 6);
                        const macd = MACD.calculate({ values: close, fastPeriod: Site.IND_MACD_FAST_PERIOD, slowPeriod: Site.IND_MACD_SLOW_PERIOD, signalPeriod: Site.IND_MACD_SIGNAL_PERIOD, SimpleMAOscillator: false, SimpleMASignal: false });
                        bull = macd.length > 0 ? (((macd[macd.length - 1].MACD || macd[macd.length - 1].MACD === 0) && (macd[macd.length - 1].signal || macd[macd.length - 1].signal === 0)) ? macd[macd.length - 1].MACD > macd[macd.length - 1].signal : false) : false;
                    }
                    else {
                        bull = bullish(csd);
                    }
                    if (bull) {
                        const adx = ADX.calculate({ close, high, low, period: Site.IND_MA_PERIOD });
                        const adxStrong = adx.length > 0 ? ((adx[adx.length - 1].adx || adx[adx.length - 1].adx === 0) ? adx[adx.length - 1].adx > 25 : false) : false;
                        Log.flow(`CE > ${name} > Trend is a ${adxStrong ? "" : "non-"}strong bullish.`, 6);
                        if ((Site.IND_ONLY_STRONG_TREND && adxStrong) || (!Site.IND_ONLY_STRONG_TREND)) {
                            const stoch = Stochastic.calculate({ close, high, low, period: Site.IND_STOCH_PERIOD, signalPeriod: Site.IND_STOCH_SIGNAL_PERIOD });
                            const rsi = RSI.calculate({ values: close, period: Math.min(Site.IND_MA_PERIOD, data.length) });
                            const stochOB = stoch.length > 0 ? (Math.max(stoch[stoch.length - 1].k, stoch[stoch.length - 1].d) > 80) : false;
                            const rsiOB = (rsi[rsi.length - 1] ?? 70) > 70;
                            const overbought = stochOB && rsiOB;
                            if ((!overbought) || (overbought && (!Site.IND_STOP_IF_OVERBOUGHT))) {
                                Log.flow(`CE > ${name} > ${overbought ? "Overbought" : "No overbought"} detected and can proceed.`, 6);
                                // entry point confirmed.
                                buy = true;
                                desc = "Confirmed Buy";
                            }
                            else {
                                Log.flow(`CE > ${name} > Can not proceed in overbought.`, 6);
                            }
                        }
                        else {
                            Log.flow(`CE > ${name} > Weak trends are not allowed.`, 6);
                        }
                    }
                    else {
                        Log.flow(`CE > ${name} > Trend is not bullish.`, 6);
                    }
                }
                else {
                    Log.flow(`CE > ${name} > No entry detected. Prev(${second ? "Bull" : "Bear"}) | Latest(${recent ? "Bull" : "Bear"}).`, 6);
                }
            }
            else {
                Log.flow(`CE > ${name} > Not enough PSAR points.`, 6);
            }

            if ((!buy) && Site.IND_BULLISH_BUY) {
                const macd = MACD.calculate({ values: close, fastPeriod: Site.IND_MACD_FAST_PERIOD, slowPeriod: Site.IND_MACD_SLOW_PERIOD, signalPeriod: Site.IND_MACD_SIGNAL_PERIOD, SimpleMAOscillator: false, SimpleMASignal: false });
                const macdBull = macd.length > 0 ? (((macd[macd.length - 1].MACD || macd[macd.length - 1].MACD === 0) && (macd[macd.length - 1].signal || macd[macd.length - 1].signal === 0)) ? macd[macd.length - 1].MACD > macd[macd.length - 1].signal : false) : false;
                const bull = bullish(csd);
                const stoch = Stochastic.calculate({ close, high, low, period: Site.IND_STOCH_PERIOD, signalPeriod: Site.IND_STOCH_SIGNAL_PERIOD });
                const rsi = RSI.calculate({ values: close, period: Math.min(Site.IND_MA_PERIOD, data.length) });
                const stochOB = stoch.length > 0 ? (Math.max(stoch[stoch.length - 1].k, stoch[stoch.length - 1].d) > 80) : false;
                const rsiOB = (rsi[rsi.length - 1] ?? 70) > 70;
                const b = macdBull && bull && psarBull && (Site.IND_STOP_IF_OVERBOUGHT ? ((!stochOB) && (!rsiOB)) : true);
                if (b) {
                    buy = true;
                    desc = "Bullish Buy"
                    Log.flow(`CE > ${name} > Bullish Buy.`, 6);
                }
            }

            const priceDir = compute1ExpDirection(close, dirLength);
            const priceDir2 = compute2ExpDirection(close, dirLength);

            CandlestickEngine.#multilayer(name, mint, buy, sell, desc, latestRate, ts)
            const signals = CandlestickEngine.#getMLSignalHistory(mint);
            CandlestickEngine.#collector(mint, latestRate, signals[signals.length - 1], buy, sell, stopLossPrice, desc);
            // const { nbuy, nsell } = CandlestickEngine.#correctSignals(signals, buy, sell, desc);
            // buy = nbuy;
            // sell = nsell;
            Log.flow(`CE > ${name} > ${desc} > SL: ${FFF(stopLossPrice)} | Mark: ${FFF(latestRate)}.`, 6);
            if ((buy || sell) && ((Date.now() - (CandlestickEngine.#emitTS[mint] || 0)) >= Site.IND_SIGNAL_COOLDOWN_PERIOD_MS)) {
                CandlestickEngine.#emitTS[mint] = Date.now();
                SignalManager.entry(mint, buy, sell, desc, stopLossPrice);
                if (buy) {
                    if (!CSBuy) {
                        CSBuy = require("./cs_buy");
                    }
                    CSBuy.entry(name, mint, desc, latestRate, stopLossPrice);
                }
            }
        }
        else {
            Log.flow(`CE > ${name} > Not enough candlestick data (${data.length} / ${Site.IND_MIN_LENGTH}).`, 6);
        }
    }

    /**
     * Performs multilayering signal check
     * @param {string[]} signals 
     * @param {boolean} buy 
     * @param {boolean} sell 
     * @param {string} desc 
     * @returns {any}
     */
    static #correctSignals = (signals, buy, sell, desc) => {
        let nbuy = buy;
        let nsell = sell;
        if (signals.length < 3) {
            nbuy = false;
            nsell = false;
        }
        else {
            if (signals.length > 3) {
                signals = signals.slice(signals.length - 3);
            }
            let signal = signals.join(" ");
            let lastSig = signals[signals.length - 1];
            if (buy) {
                if (desc.includes("BULL")) {
                    nbuy = signal == "FHNP FHNP BDNP" || signal == "FGNO FHNP BDNP";
                }
                else {
                    nbuy = signal == "BCNO ADMP ADMP" || signal == "ADMP ADMP ADMP";
                }
            }
            if (sell) {
                if (desc.includes("BULL")) {
                    nsell = lastSig == "EHIL";
                }
                else {
                    nsell = lastSig == "FGJK";
                }
            }
        }
        return { nbuy, nsell };
    }

    static #collectedData = {}

    /**
     * Gracious exit function
     * @returns {Promise<boolean>}
     */
    static exit = () => {
        return new Promise((resolve, reject) => {
            try {
                if (Site.IND_ML_COLLECT_DATA && (!Site.PRODUCTION)) {
                    fs.writeFileSync(Site.IND_ML_DATA_PATH, JSON.stringify(CandlestickEngine.#collectedData, null, "\t"));
                    Log.flow("CandlestickEngine > Data collection saved.");
                }
            } catch (error) {

            }
            finally {
                resolve(true);
            }
        })
    }

    /**
     * Keeps track of last time a collected file was sent
     * @type {number}
     */
    static #lastChecked = 0;

    /**
     * 
     * @param {string} mint 
     * @param {number} rate 
     * @param {string} signal 
     * @param {boolean} buy 
     * @param {boolean} sell 
     * @param {number} sl 
     * @param {string} desc 
     */
    static #collector = (
        mint,
        rate,
        signal,
        buy,
        sell,
        sl,
        desc
    ) => {
        if (Site.IND_ML_COLLECT_DATA) {
            if (!CandlestickEngine.#collectedData[mint]) {
                CandlestickEngine.#collectedData[mint] = [];
            }
            if (signal) {
                CandlestickEngine.#collectedData[mint].push({
                    rate,
                    signal,
                    buy,
                    sell,
                    sl,
                    desc,
                });
                if ((Date.now() - CandlestickEngine.#lastChecked) >= Site.COLLECTOR_CHECKER_COOLDOWN_MS) {
                    try {
                        if (!TelegramEngine) {
                            TelegramEngine = require("./telegram");
                        }
                        const content = JSON.stringify(CandlestickEngine.#collectedData);
                        const size = calculateUtf8FileSize(content);
                        if (size >= Site.COLLECTOR_MAX_FILE_SIZE_BYTES) {
                            CandlestickEngine.sendCollected();
                        }
                    } catch (error) {
                        Log.dev(error);
                    }
                }
            }
        }
    }

    static sendCollected = async () => {
        try {
            if (!TelegramEngine) {
                TelegramEngine = require("./telegram");
            }
            const content = JSON.stringify(CandlestickEngine.#collectedData);
            if (content.length > 0) {
                let caption = `*Collected Candlestick Analysis Data* - ${getDateTime()}`;
                const d = new Date();
                let filename = `${d.getFullYear().toString().padStart(2, '0')}${(d.getMonth() + 1).toString().padStart(2, '0')}${(d.getDate()).toString().padStart(2, '0')}${d.getHours().toString().padStart(2, '0')}${d.getMinutes().toString().padStart(2, '0')}${d.getSeconds().toString().padStart(2, '0')}.json`;
                const done = await TelegramEngine.sendStringAsJSONFile(content, caption, filename);
                if (done) {
                    CandlestickEngine.#collectedData = {};
                }
            }
        } catch (error) {
            Log.dev(error);
        }
    }

    /**
     * Holds most recent decision made on a token
     * @type {Record<string, Decision>}
     */
    static #latestDecisions = {};

    /**
     * Holds signal data per each token
     * @type {Record<string, SignalGraph>}
     */
    static #signals = {};

    /**
     * Holds signal history per each token
     * @type {Record<string, string[]};
     */
    static #signalHistory = {};


    /**
     * Get token's signal history
     * @param {string} mint
     * @returns {string[]}
     */
    static #getMLSignalHistory = (mint) => {
        /**
         * @type {string[]}
         */
        let history = [];
        if (CandlestickEngine.#signalHistory[mint]) {
            history = history.concat(CandlestickEngine.#signalHistory[mint]);
        }
        if (CandlestickEngine.#signals[mint] ? CandlestickEngine.#signals[mint].signals.length > 0 : false) {
            history = history.concat([CandlestickEngine.#signals[mint].signals.sort((a, b) => a.localeCompare(b)).join("")]);
        }
        if (history.length > Site.IND_MAX_SIGNAL_HISTORY_LENGTH) {
            history = history.slice(history.length - Site.IND_MAX_SIGNAL_HISTORY_LENGTH);
        }
        return history
    }

    /**
     * Computes multilayering
     * @param {string} name 
     * @param {string} mint 
     * @param {boolean} buy 
     * @param {boolean} sell 
     * @param {string} desc 
     * @param {number} rate 
     * @param {number} ts 
     */
    static #multilayer = (name, mint, buy, sell, desc, rate, ts) => {
        // Ensure objects are initialized
        if (!CandlestickEngine.#signals[mint]) {
            CandlestickEngine.#signals[mint] = new SignalGraph();
        }
        if (!CandlestickEngine.#signalHistory[mint]) {
            CandlestickEngine.#signalHistory[mint] = [];
        }
        if (ts !== CandlestickEngine.#signals[mint].ts && CandlestickEngine.#signals[mint].signals.length > 0) {
            // harvest
            CandlestickEngine.#signalHistory[mint].push(CandlestickEngine.#signals[mint].signals.sort((a, b) => a.localeCompare(b)).join(""));
            if (CandlestickEngine.#signalHistory[mint].length > Site.IND_MAX_SIGNAL_HISTORY_LENGTH) {
                CandlestickEngine.#signalHistory[mint] = CandlestickEngine.#signalHistory[mint].slice(CandlestickEngine.#signalHistory[mint].length - Site.IND_MAX_SIGNAL_HISTORY_LENGTH);
            }
            CandlestickEngine.#signals[mint].signals = [];
        }
        CandlestickEngine.#signals[mint].ts = ts;
        if (CandlestickEngine.#latestDecisions[mint]) {
            if (buy) {
                if (CandlestickEngine.#latestDecisions[mint].buy) {
                    if (CandlestickEngine.#signals[mint].signals.indexOf("A") == -1) {
                        CandlestickEngine.#signals[mint].signals.push("A");
                    }
                }
                else {
                    if (CandlestickEngine.#signals[mint].signals.indexOf("B") == -1) {
                        CandlestickEngine.#signals[mint].signals.push("B");
                    }
                }
                if (CandlestickEngine.#latestDecisions[mint].sell) {
                    if (CandlestickEngine.#signals[mint].signals.indexOf("C") == -1) {
                        CandlestickEngine.#signals[mint].signals.push("C");
                    }
                }
                else {
                    if (CandlestickEngine.#signals[mint].signals.indexOf("D") == -1) {
                        CandlestickEngine.#signals[mint].signals.push("D");
                    }
                }
            }
            else {
                if (CandlestickEngine.#latestDecisions[mint].buy) {
                    if (CandlestickEngine.#signals[mint].signals.indexOf("E") == -1) {
                        CandlestickEngine.#signals[mint].signals.push("E");
                    }
                }
                else {
                    if (CandlestickEngine.#signals[mint].signals.indexOf("F") == -1) {
                        CandlestickEngine.#signals[mint].signals.push("F");
                    }
                }
                if (CandlestickEngine.#latestDecisions[mint].sell) {
                    if (CandlestickEngine.#signals[mint].signals.indexOf("G") == -1) {
                        CandlestickEngine.#signals[mint].signals.push("G");
                    }
                }
                else {
                    if (CandlestickEngine.#signals[mint].signals.indexOf("H") == -1) {
                        CandlestickEngine.#signals[mint].signals.push("H");
                    }
                }
            }
            if (sell) {
                if (CandlestickEngine.#latestDecisions[mint].buy) {
                    if (CandlestickEngine.#signals[mint].signals.indexOf("I") == -1) {
                        CandlestickEngine.#signals[mint].signals.push("I");
                    }
                }
                else {
                    if (CandlestickEngine.#signals[mint].signals.indexOf("J") == -1) {
                        CandlestickEngine.#signals[mint].signals.push("J");
                    }
                }
                if (CandlestickEngine.#latestDecisions[mint].sell) {
                    if (CandlestickEngine.#signals[mint].signals.indexOf("K") == -1) {
                        CandlestickEngine.#signals[mint].signals.push("K");
                    }
                }
                else {
                    if (CandlestickEngine.#signals[mint].signals.indexOf("L") == -1) {
                        CandlestickEngine.#signals[mint].signals.push("L");
                    }
                }
            }
            else {
                if (CandlestickEngine.#latestDecisions[mint].buy) {
                    if (CandlestickEngine.#signals[mint].signals.indexOf("M") == -1) {
                        CandlestickEngine.#signals[mint].signals.push("M");
                    }
                }
                else {
                    if (CandlestickEngine.#signals[mint].signals.indexOf("N") == -1) {
                        CandlestickEngine.#signals[mint].signals.push("N");
                    }
                }
                if (CandlestickEngine.#latestDecisions[mint].sell) {
                    if (CandlestickEngine.#signals[mint].signals.indexOf("O") == -1) {
                        CandlestickEngine.#signals[mint].signals.push("O");
                    }
                }
                else {
                    if (CandlestickEngine.#signals[mint].signals.indexOf("P") == -1) {
                        CandlestickEngine.#signals[mint].signals.push("P");
                    }
                }
            }
        }
        if (!CandlestickEngine.#latestDecisions[mint]) {
            CandlestickEngine.#latestDecisions[mint] = new Decision();
        }
        CandlestickEngine.#latestDecisions[mint].buy = buy;
        CandlestickEngine.#latestDecisions[mint].sell = sell
    }
}

module.exports = CandlestickEngine;