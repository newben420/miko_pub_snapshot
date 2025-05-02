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
     * Holds take profit data for a token
     * @type {Record<string, number[]>}
     */
    static #tp = {};

    /**
     * Holds volatility data for a token
     * @type {Record<string, number[]>}
     */
    static #vol = {};

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

            let buy = false;
            let sell = false;
            let desc = "";

            const latestRate = close[close.length - 1];

            const csd = { open, close, high, low };
            const dirLength = Math.min(Site.IND_DIR_LENGTH, data.length);

            // PRIMARY INDICATORS
            const macd = MACD.calculate({ values: close, fastPeriod: Site.IND_MACD_FAST_PERIOD, slowPeriod: Site.IND_MACD_SLOW_PERIOD, signalPeriod: Site.IND_MACD_SIGNAL_PERIOD, SimpleMAOscillator: false, SimpleMASignal: false });
            const psar = PSAR.calculate({ high, low, step: Site.IND_PSAR_STEP, max: Site.IND_PSAR_MAX });
            const stoch = Stochastic.calculate({ close, high, low, period: Site.IND_STOCH_PERIOD, signalPeriod: Site.IND_STOCH_SIGNAL_PERIOD });
            // PRIMARY COMPUTATIONS
            const macdBull = macd.length > 0 ? (((macd[macd.length - 1].MACD || macd[macd.length - 1].MACD === 0) && (macd[macd.length - 1].signal || macd[macd.length - 1].signal === 0)) ? macd[macd.length - 1].MACD > macd[macd.length - 1].signal : false) : false;
            const macdBear = macd.length > 0 ? (((macd[macd.length - 1].MACD || macd[macd.length - 1].MACD === 0) && (macd[macd.length - 1].signal || macd[macd.length - 1].signal === 0)) ? macd[macd.length - 1].MACD < macd[macd.length - 1].signal : false) : false;
            const psarBull = (psar[psar.length - 1] ?? latestRate) < latestRate;
            const psarBear = (psar[psar.length - 1] ?? latestRate) > latestRate;
            const stochOB = stoch.length > 0 ? (Math.max(stoch[stoch.length - 1].k, stoch[stoch.length - 1].d) > 80) : false;
            const stochOS = stoch.length > 0 ? (Math.max(stoch[stoch.length - 1].k, stoch[stoch.length - 1].d) < 20) : false;
            const stochBull = stochOB ? false : (stoch.length > 1 ? (((stoch[stoch.length - 1].k || stoch[stoch.length - 1].k === 0) && (stoch[stoch.length - 1].d || stoch[stoch.length - 1].d === 0)) ? (stoch[stoch.length - 1].k > stoch[stoch.length - 1].d) : false) : false);
            const stochBear = stochOS ? false : (stoch.length > 1 ? (((stoch[stoch.length - 1].k || stoch[stoch.length - 1].k === 0) && (stoch[stoch.length - 1].d || stoch[stoch.length - 1].d === 0)) ? (stoch[stoch.length - 1].k < stoch[stoch.length - 1].d) : false) : false);

            // COMPUTE TREND CONFIRMATION AND SUPORTING INDICATORS
            const trendBull = bullish(csd);
            const trendBear = bearish(csd);
            const vwap = VWAP.calculate({ close, high, low, volume });
            const vwapBull = vwap.length > 0 ? latestRate > vwap[vwap.length - 1] : false;
            const vwapBear = vwap.length > 0 ? latestRate < vwap[vwap.length - 1] : false;
            const adl = ADL.calculate({ close, high, low, volume });
            const adlDir = compute1ExpDirection(adl, dirLength);
            const priceDir = compute1ExpDirection(close, dirLength);
            const priceDir2 = compute2ExpDirection(close, dirLength);
            const adlBull = adlDir > 0 && priceDir > 0;
            const adlBear = adlDir < 0 && priceDir < 0;
            const atr = ATR.calculate({ close, high, low, period: Site.IND_MA_PERIOD });
            const ao = AwesomeOscillator.calculate({ fastPeriod: Site.IND_AO_FAST_PERIOD, slowPeriod: Site.IND_AO_SLOW_PERIOD, high, low });
            const aoBull = (ao[ao.length - 1] ?? -1) > 0;
            const aoBear = (ao[ao.length - 1] ?? 1) < 0;
            const roc = ROC.calculate({ values: close, period: Site.IND_MA_PERIOD });
            const rocDir = computeArithmeticDirection(roc, dirLength);
            const rocBull = (roc[roc.length - 1] ?? -1) > 0;
            const rocBear = (roc[roc.length - 1] ?? 1) < 0;
            const fi = ForceIndex.calculate({ close, volume, period: Site.IND_FI_PERIOD });
            const fiDir = computeArithmeticDirection(fi, dirLength);
            const fiBull = fiDir > 0 && (fi[fi.length - 1] ?? 0) > 0;
            const fiBear = fiDir < 0 && (fi[fi.length - 1] ?? 0) < 0;
            const trix = TRIX.calculate({ period: Site.IND_MA_PERIOD, values: close });
            const trixBull = (trix[trix.length - 1] ?? 0) > 0;
            const trixBear = (trix[trix.length - 1] ?? 0) < 0;
            const adx = ADX.calculate({ close, high, low, period: Site.IND_MA_PERIOD });
            const adxStrong = adx.length > 0 ? ((adx[adx.length - 1].adx || adx[adx.length - 1].adx === 0) ? adx[adx.length - 1].adx > 25 : false) : false;
            const adxWeak = adx.length > 0 ? ((adx[adx.length - 1].adx || adx[adx.length - 1].adx === 0) ? adx[adx.length - 1].adx < 20 : false) : false;
            const bb = BollingerBands.calculate({ period: Site.IND_BB_PERIOD, stdDev: Site.IND_BB_STDDEV, values: close });
            const bbBuy = bb.length > 0 ? latestRate < bb[bb.length - 1].lower : false;
            const bbSell = bb.length > 0 ? latestRate > bb[bb.length - 1].upper : false;

            const cci = CCI.calculate({ close, high, low, period: Site.IND_MA_PERIOD });
            const mfi = MFI.calculate({ close, high, low, volume, period: Math.min(Site.IND_MA_PERIOD, data.length) });
            const rsi = RSI.calculate({ values: close, period: Math.min(Site.IND_MA_PERIOD, data.length) });

            // PRE-FLOW
            const overallBull = macdBull && (psarBull || stochBull);
            const overallBear = macdBear && (psarBear || stochBear);
            const supportBull = booleanThreshold([
                trendBull,
                vwapBull,
                adlBull,
                aoBull,
                rocBull,
                fiBull,
                trixBull,
            ], Site.IND_TREND_SUPPORT_THRESHOLD_RATIO);
            const supportBear = booleanThreshold([
                trendBear,
                vwapBear,
                adlBear,
                aoBear,
                rocBear,
                fiBear,
                trixBear,
            ], Site.IND_TREND_SUPPORT_THRESHOLD_RATIO);
            const goodBuy = bbBuy;
            const goodSell = bbSell;
            const volatilityPerc = (atr.length > 0 ? atr[atr.length - 1] : 0) / latestRate * 100;
            const TPSLPerc = Math.abs((psar[psar.length - 1] ?? latestRate) - latestRate) / latestRate * 100;
            if (!CandlestickEngine.#tp[mint]) {
                CandlestickEngine.#tp[mint] = [];
            }
            if (!CandlestickEngine.#vol[mint]) {
                CandlestickEngine.#vol[mint] = [];
            }
            CandlestickEngine.#tp[mint].push(TPSLPerc);
            CandlestickEngine.#vol[mint].push(volatilityPerc);
            if (CandlestickEngine.#tp[mint].length > dirLength) {
                CandlestickEngine.#tp[mint] = CandlestickEngine.#tp[mint].slice(CandlestickEngine.#tp[mint].length - dirLength);
            }
            if (CandlestickEngine.#vol[mint].length > dirLength) {
                CandlestickEngine.#vol[mint] = CandlestickEngine.#vol[mint].slice(CandlestickEngine.#vol[mint].length - dirLength);
            }

            // FLOW
            if (overallBull) {
                const weak = adxWeak;
                const cciOB = (cci[cci.length - 1] ?? -1) > 100;
                const mfiOB = (mfi[mfi.length - 1] ?? 80) > 80;
                const rsiOB = (rsi[rsi.length - 1] ?? 70) > 70;
                const OROverBought = stochOB || cciOB || mfiOB || rsiOB;
                const BTOverbought = booleanThreshold([cciOB, mfiOB, rsiOB, stochOB], (3 / 4));
                const rocBearDive = priceDir > 0 && rocDir < 0;
                const fiBearDive = priceDir > 0 && fiDir < 0;
                const divergence = rocBearDive || fiBearDive;
                const reversal = OROverBought ? (BTOverbought || divergence) : false;

                if (reversal) {
                    buy = false;
                    sell = true;
                    desc = "BULL EXIT";
                }
                else if ((!weak) || supportBull || goodBuy) {
                    buy = `${clearDirection(CandlestickEngine.#vol[mint], dirLength)}${clearDirection(CandlestickEngine.#tp[mint], dirLength)}` != '11';
                    sell = false;
                    desc = "BULL ENTRY";
                }
                else {
                    buy = false;
                    sell = false;
                    desc = "WEAK BULL";
                }
            }
            else if (overallBear) {
                const strong = adxStrong;
                const candlestickBullishReversal = abandonedbaby(csd) || bullishengulfingpattern(csd) ||
                    threewhitesoldiers(csd) || morningstar(csd) || morningdojistar(csd) || hammerpattern(csd) ||
                    dragonflydoji(csd) || bullishharami(csd) || bullishmarubozu(csd) || bullishharamicross(csd) ||
                    tweezerbottom(csd);
                const cciOS = (cci[cci.length - 1] ?? 1) < -100;
                const mfiOS = (mfi[mfi.length - 1] ?? 20) < 20;
                const rsiOS = (rsi[rsi.length - 1] ?? 30) < 30;
                const OROverSold = stochOS || cciOS || mfiOS || rsiOS;
                const BTOversold = booleanThreshold([cciOS, mfiOS, rsiOS, stochOS], (1 / 2));
                const rocBullDive = priceDir < 0 && rocDir > 0;
                const fiBullDive = priceDir < 0 && fiDir > 0;
                const divergence = rocBullDive || fiBullDive;
                const reversal = OROverSold ? (BTOversold || divergence || candlestickBullishReversal) : false;

                if (reversal) {
                    buy = `${clearDirection(CandlestickEngine.#vol[mint], dirLength)}${clearDirection(CandlestickEngine.#tp[mint], dirLength)}` == '11';
                    sell = false;
                    desc = "BEAR ENTRY";
                }
                else if (strong || supportBear || goodSell) {
                    buy = false;
                    sell = true;
                    desc = "BEAR EXIT";
                }
                else {
                    buy = false;
                    sell = false;
                    desc = "WEAK BEAR";
                }
            }
            else {
                const possibleEntry = goodBuy && supportBull && (computeArithmeticDirection(close, Site.directionLength) >= 0);
                if (possibleEntry) {
                    buy = true;
                    sell = false;
                    desc = "NO TREND ENTRY";
                }
                else {
                    buy = false;
                    sell = false;
                    desc = "NO TREND NO ACTION";
                }
            }
            const rate = latestRate;
            const vol = volatilityPerc;
            const tpsl = TPSLPerc;
            CandlestickEngine.#multilayer(name, mint, buy, sell, desc, rate, ts)
            const signals = CandlestickEngine.#getMLSignalHistory(mint);
            CandlestickEngine.#collector(mint, rate, signals[signals.length - 1], buy, sell, vol, tpsl, desc);
            const { nbuy, nsell } = CandlestickEngine.#correctSignals(signals, buy, sell, desc);
            buy = nbuy;
            sell = nsell;
            if(buy || sell){
                SignalManager.entry(mint, buy, sell, desc, vol, tpsl);
            }
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
        if(signals.length < 3){
            nbuy = false;
            nsell = false;
        }
        else{
            if(signals.length > 3){
                signals = signals.slice(signals.length - 3);
            }
            let signal = signals.join(" ");
            let lastSig = signals[signals.length - 1];
            if(buy){
                if(desc.includes("BULL")){
                    nbuy = signal == "FHNP FHNP BDNP" || signal == "FGNO FHNP BDNP";
                }
                else{
                    nbuy = signal == "BCNO ADMP ADMP" || signal == "ADMP ADMP ADMP";
                }
            }
            if(sell){
                if(desc.includes("BULL")){
                    nsell = lastSig == "EHIL";
                }
                else{
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
                if (Site.IND_ML_COLLECT_DATA) {
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
     * 
     * @param {string} mint 
     * @param {number} rate 
     * @param {string} signal 
     * @param {boolean} buy 
     * @param {boolean} sell 
     * @param {number} vol 
     * @param {number} tpsl 
     * @param {string} desc 
     */
    static #collector = (
        mint,
        rate,
        signal,
        buy,
        sell,
        vol,
        tpsl,
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
                    vol,
                    tpsl,
                    desc,
                });
            }
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