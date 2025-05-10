const Site = require("../env");
const fs = Site.IND_CFG.MCLD ? require("fs") : {};
const booleanThreshold = require("../lib/boolean_threshold");
const { compute1ExpDirection, compute2ExpDirection, computeArithmeticDirection, clearDirection } = require("../lib/direction");
const {
    MACD, PSAR, Stochastic, bullish, bearish, VWAP, ADL, ATR, AwesomeOscillator, ROC, ForceIndex,
    TRIX, ADX, BollingerBands, CCI, MFI, RSI, abandonedbaby, bearishengulfingpattern, darkcloudcover,
    piercingline, eveningstar, eveningdojistar, threeblackcrows, gravestonedoji, bearishharami, bearishmarubozu,
    tweezertop, hangingman, shootingstar, bearishharamicross, morningstar, threewhitesoldiers, bullishengulfingpattern,
    morningdojistar, hammerpattern, dragonflydoji, bullishharami, bullishmarubozu, bullishharamicross, tweezerbottom,
    EMA,
    IchimokuCloud,
    SMA,
    WMA,
    StochasticRSI,
} = require("technicalindicators");
const Log = require("../lib/log");
const SignalManager = require("./signal_manager");
const FFF = require("../lib/fff");
const calculateUtf8FileSize = require("../lib/file_size");
const getDateTime = require("../lib/get_date_time");
const booleanConsolidator = require("../lib/boolean_consolidator");
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
     * Holds previous entry values per token
     * @type {Record<string, boolean[]>}
     */
    static #isEntry = {};

    /**
     * Called when a token is deleted from token engine so its data can be cleared here as well
     * @param {string} mint 
     */
    static removeToken = (mint) => {
        delete CandlestickEngine.#isEntry[mint];
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
        return new Promise((resolve, reject) => {
            if (data.length >= (Site.IND_CFG.MLN || 10)) {
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

                const dirLength = Math.min(Site.IND_CFG.DIL, data.length);

                const csd = { open, close, high, low };

                let cache = {
                    PSR: null,
                    PSR_BULL: null,
                    PSR_BEAR: null,
                    PSR_SL: null,
                    MCD: null,
                    MCD_BULL: null,
                    MCD_BEAR: null,
                    ICH: null,
                    ICH_BULL: null,
                    ICH_BEAR: null,
                    ICH_SL: null,
                    BLL_BULL: null,
                    SMA_BULL: null,
                    EMA_BULL: null,
                    WMA_BULL: null,
                    VWP_BULL: null,
                    AOS_BULL: null,
                    TRX_BULL: null,
                    STRONG: null,
                    STC_OB: null,
                    RSI_OB: null,
                    CCI_OB: null,
                    MFI_OB: null,
                    BBS_OB: null,
                    SRS_OB: null,
                    STR: null,
                    HGM: null,
                    BAR: null,
                    EST: null,
                    TBC: null,
                    PIL: null,
                    DCC: null,
                    TTP: null,
                    ATR: null,
                    ENTRY: false,
                };

                const ensureInd = {
                    PSR: () => {
                        if (!cache.PSR) {
                            const psar = PSAR.calculate({ high, low, step: Site.IND_CFG.PSR_ST ?? 0.02, max: Site.IND_CFG.PSR_MX ?? 0.2 });
                            const psarBull = (psar[psar.length - 1] ?? latestRate) < latestRate;
                            const psarBear = (psar[psar.length - 1] ?? latestRate) > latestRate;
                            const sl = psar[psar.length - 1] || 0;
                            cache.PSR = true;
                            cache.PSR_BULL = psarBull;
                            cache.PSR_BEAR = psarBear;
                            cache.PSR_SL = sl;
                        }
                    },
                    MCD: () => {
                        if (!cache.MCD) {
                            const macd = MACD.calculate({ values: close, fastPeriod: Site.IND_CFG.MCD_FSP ?? 12, slowPeriod: Site.IND_CFG.MCD_SLP ?? 26, signalPeriod: Site.IND_CFG.MCD_SGP ?? 9, SimpleMAOscillator: false, SimpleMASignal: false });
                            const macdBull = macd.length > 0 ? (((macd[macd.length - 1].MACD || macd[macd.length - 1].MACD === 0) && (macd[macd.length - 1].signal || macd[macd.length - 1].signal === 0)) ? macd[macd.length - 1].MACD > macd[macd.length - 1].signal : false) : false;
                            const macdBear = macd.length > 0 ? (((macd[macd.length - 1].MACD || macd[macd.length - 1].MACD === 0) && (macd[macd.length - 1].signal || macd[macd.length - 1].signal === 0)) ? macd[macd.length - 1].MACD < macd[macd.length - 1].signal : false) : false;
                            cache.MCD = true;
                            cache.MCD_BULL = macdBull;
                            cache.MCD_BEAR = macdBear;
                        }
                    },
                    ICH: () => {
                        if (!cache.ICH) {
                            const ichimoku = IchimokuCloud.calculate({
                                high,
                                low,
                                conversionPeriod: Site.IND_CFG.ICH_CVP ?? 9,
                                basePeriod: Site.IND_CFG.ICH_BSP ?? 26,
                                spanPeriod: Site.IND_CFG.ICH_SPP ?? 52,
                                displacement: Site.IND_CFG.ICH_DIS ?? 26,
                            });
                            const conversion = (ichimoku[ichimoku.length - 1] || {}).conversion ?? 0;
                            const base = (ichimoku[ichimoku.length - 1] || {}).base ?? 0;
                            const spanA = (ichimoku[ichimoku.length - 1] || {}).spanA ?? 0;
                            const spanB = (ichimoku[ichimoku.length - 1] || {}).spanB ?? 0;
                            const lag = close[close.length - (Site.IND_CFG.ICH_DIS ?? 26) - 1] ?? 0;
                            const lagSpanA = (ichimoku[ichimoku.length - 1 - (Site.IND_CFG.ICH_DIS ?? 26)] || {}).spanA ?? 0;
                            const lagSpanB = (ichimoku[ichimoku.length - 1 - (Site.IND_CFG.ICH_DIS ?? 26)] || {}).spanB ?? 0;
                            const bull = (latestRate > spanA) && (spanA > spanB) && (conversion > base) && (lag > Math.max(lagSpanA, lagSpanB));
                            const bear = (latestRate < spanA) && (spanA < spanB) && (conversion < base) && (lag < Math.min(lagSpanA, lagSpanB));
                            let sl = spanB;
                            cache.ICH = true;
                            cache.ICH_BULL = bull;
                            cache.ICH_BEAR = bear;
                            cache.ICH_SL = sl;
                        }
                    },
                    BLL: () => {
                        if (cache.BLL_BULL === null) {
                            cache.BLL_BULL = bullish(csd);
                        }
                    },
                    SMA: () => {
                        if (cache.SMA_BULL === null) {
                            const ma = SMA.calculate({ values: close, period: Site.IND_CFG.MAP ?? 20 });
                            cache.SMA_BULL = latestRate > (ma[ma.length - 1] || Infinity);
                        }
                    },
                    EMA: () => {
                        if (cache.EMA_BULL === null) {
                            const ma = EMA.calculate({ values: close, period: Site.IND_CFG.MAP ?? 20 });
                            cache.EMA_BULL = latestRate > (ma[ma.length - 1] || Infinity);
                        }
                    },
                    WMA: () => {
                        if (cache.WMA_BULL === null) {
                            const ma = WMA.calculate({ values: close, period: Site.IND_CFG.MAP ?? 20 });
                            cache.WMA_BULL = latestRate > (ma[ma.length - 1] || Infinity);
                        }
                    },
                    VWP: () => {
                        if (cache.VWP_BULL === null) {
                            const vwap = VWAP.calculate({ close, high, low, volume });
                            cache.VWP_BULL = latestRate > (vwap[vwap.length - 1] || Infinity);
                        }
                    },
                    AOS: () => {
                        if (cache.AOS_BULL === null) {
                            const ao = AwesomeOscillator.calculate({ high, low, fastPeriod: Site.IND_CFG.AOS_FSP ?? 5, slowPeriod: Site.IND_CFG.AOS_SLP ?? 34, })
                            cache.AOS_BULL = (ao[ao.length - 1] || 0) > 0;
                        }
                    },
                    TRX: () => {
                        if (cache.TRX_BULL === null) {
                            const trix = TRIX.calculate({ values: close, period: Site.IND_CFG.TRX_P ?? 15 });
                            cache.TRX_BULL = (trix[trix.length - 1] || 0) > 0;
                        }
                    },
                    ADX: () => {
                        if (cache.STRONG === null) {
                            const adx = ADX.calculate({ close, high, low, period: Site.IND_CFG.ADX_P ?? 14 });
                            cache.STRONG = ((adx[adx.length - 1] || {}).adx || 0) > 25;
                        }
                    },
                    STC: () => {
                        if (cache.STC_OB === null) {
                            const stoch = Stochastic.calculate({ close, high, low, period: Site.IND_CFG.STC_P ?? 14, signalPeriod: Site.IND_CFG.STC_SP ?? 3 })
                            cache.STC_OB = ((stoch[stoch.length - 1] || {}).k || 0) > 80;
                        }
                    },
                    RSI: () => {
                        if (cache.RSI_OB === null) {
                            const rsi = RSI.calculate({ values: close, period: Site.IND_CFG.RSI_P ?? 14 })
                            cache.RSI_OB = (rsi[rsi.length - 1] || 0) > 70;
                        }
                    },
                    CCI: () => {
                        if (cache.CCI_OB === null) {
                            const cci = CCI.calculate({ close, high, low, period: Site.IND_CFG.CCI_P ?? 14 })
                            cache.CCI_OB = (cci[cci.length - 1] || 0) > 100;
                        }
                    },
                    MFI: () => {
                        if (cache.MFI_OB === null) {
                            const mfi = MFI.calculate({ close, volume, high, low, period: Site.IND_CFG.MFI_P ?? 14 });
                            cache.MFI_OB = (mfi[mfi.length - 1] || 0) > 80;
                        }
                    },
                    SRS: () => {
                        if (cache.SRS_OB === null) {
                            const srsi = StochasticRSI.calculate({
                                dPeriod: Site.IND_CFG.STC_SP ?? 3,
                                kPeriod: Site.IND_CFG.STC_SP ?? 3,
                                rsiPeriod: Site.IND_CFG.RSI_P ?? 14,
                                stochasticPeriod: Site.IND_CFG.STC_P ?? 14,
                                values: close,
                            });
                            cache.SRS_OB = (((srsi[srsi.length - 1] || {}).stochRSI || 0) > 80);
                        }
                    },
                    STR: () => {
                        if (cache.STR === null) {
                            cache.STR = shootingstar(csd);
                        }
                    },
                    HGM: () => {
                        if (cache.HGM === null) {
                            cache.HGM = hangingman(csd);
                        }
                    },
                    BAR: () => {
                        if (cache.BAR === null) {
                            cache.BAR = bearish(csd);
                        }
                    },
                    EST: () => {
                        if (cache.EST === null) {
                            cache.EST = eveningstar(csd);
                        }
                    },
                    TBC: () => {
                        if (cache.TBC === null) {
                            cache.TBC = threeblackcrows(csd);
                        }
                    },
                    PIL: () => {
                        if (cache.PIL === null) {
                            cache.PIL = piercingline(csd);
                        }
                    },
                    DCC: () => {
                        if (cache.DCC === null) {
                            cache.DCC = darkcloudcover(csd);
                        }
                    },
                    TTP: () => {
                        if (cache.TTP === null) {
                            cache.TTP = tweezertop(csd);
                        }
                    },
                    ATR: () => {
                        if (cache.ATR === null) {
                            const atr = ATR.calculate({ period: Site.IND_CFG.ATR_P ?? 14, close, high, low });
                            const perc = ((atr[atr.length - 1] || 0) / latestRate) * 100;
                            cache.ATR = perc;
                        }
                    },
                }

                /**
                 * Computes entry point.
                 * @returns {boolean} True if entry detected else False.
                 */
                const step1 = () => {
                    ensureInd[Site.STR_ENTRY_IND]();
                    if (!CandlestickEngine.#isEntry[mint]) {
                        CandlestickEngine.#isEntry[mint] = [];
                    }
                    CandlestickEngine.#isEntry[mint].push(cache[`${Site.STR_ENTRY_IND}_BULL`] || false);
                    if (CandlestickEngine.#isEntry[mint].length > (Site.IND_CFG.DIL || 5)) {
                        CandlestickEngine.#isEntry[mint] = CandlestickEngine.#isEntry[mint].slice(CandlestickEngine.#isEntry[mint].length - (Site.IND_CFG.DIL || 5));
                    }
                    return CandlestickEngine.#isEntry[mint].length >= 2 ? (CandlestickEngine.#isEntry[mint][CandlestickEngine.#isEntry[mint].length - 1] && (!CandlestickEngine.#isEntry[mint][CandlestickEngine.#isEntry[mint].length - 2])) : false;
                }

                /**
                 * Confirms bull trend.
                 * @returns {boolean} True if bull trend else False.
                 */
                const step2 = () => {
                    for (let i = 0; i < Site.STR_TREND_IND.length; i++) {
                        ensureInd[Site.STR_TREND_IND[i]]();
                    }
                    /**
                     * @type {boolean[]}
                     */
                    const bools = Site.STR_TREND_IND.map(x => cache[`${x}_BULL`] || false);
                    return booleanConsolidator(bools, Site.STR_TREND_CV);
                }

                /**
                 * Confirms strong trend.
                 * @returns {boolean} True if strong trend else False.
                 */
                const step3 = () => {
                    ensureInd.ADX();
                    return cache.STRONG || false;
                }

                /**
                 * Detects overbought.
                 * @returns {boolean} True if overbought else False.
                 */
                const step4 = () => {
                    for (let i = 0; i < Site.STR_OB_IND.length; i++) {
                        ensureInd[Site.STR_OB_IND[i]]();
                    }
                    /**
                     * @type {boolean[]}
                     */
                    const bools = Site.STR_OB_IND.map(x => cache[`${x}_OB`] || false);
                    return booleanConsolidator(bools, Site.STR_OB_CV);
                }

                /**
                 * Detects reversal patterns.
                 * @returns {boolean} True if reversal else False.
                 */
                const step5 = () => {
                    for (let i = 0; i < Site.STR_REV_IND.length; i++) {
                        ensureInd[Site.STR_REV_IND[i]]();
                    }
                    /**
                     * @type {boolean[]}
                     */
                    const bools = Site.STR_REV_IND.map(x => cache[`${x}`] || false);
                    return booleanConsolidator(bools, Site.STR_REV_CV);
                }

                /**
                 * Computes stoploss price.
                 * @returns {number}
                 */
                const step6 = () => {
                    ensureInd[Site.STR_TSL_IND]();
                    return cache[`${Site.STR_TSL_IND}_SL`];
                }

                /**
                 * Ensures price volatility is within suitable percentage range.
                 * @returns {boolean} True if within range else False.
                 */
                const step7 = () => {
                    ensureInd.ATR();
                    return cache.ATR >= (Site.STR_VOL_RNG[0] || 0) && cache.ATR <= (Site.STR_VOL_RNG[1] || Infinity);
                }


                let stoploss = 0;
                let buy = false;
                let sell = false;
                let desc = "No Signal";

                // STRATEGY NAME => 7 STEPS TO HEAVEN (H7)
                Log.flow(`CS > ${name} > Checking for entry...`, 6);
                if (step1()) {
                    // Entry detected.
                    cache.ENTRY = true;
                    Log.flow(`CS > ${name} > Entry detected. Confirming bull trend...`, 6);
                    if ((Site.STR_TREND_FV && step2()) || (!Site.STR_TREND_FV)) {
                        // Trend confirmed.
                        Log.flow(`CS > ${name} > Trend confirmed. Checking trend strength...`, 6);
                        if ((Site.STR_STG_FV && step3()) || (!Site.STR_STG_FV)) {
                            // Trend strength confirmed.
                            Log.flow(`CS > ${name} > Strength is acceptable. Checking if overbought...`, 6);
                            if ((Site.STR_OB_FV && (!step4())) || (!Site.STR_OB_FV)) {
                                // No presence of effecting overbought confirmed.
                                Log.flow(`CS > ${name} > Overbought condition acceptable. Checking for reversals...`, 6);
                                if ((Site.STR_REV_FV && (!step5())) || (!Site.STR_REV_FV)) {
                                    Log.flow(`CS > ${name} > Reversal conditions acceptable. Calculating stop loss...`, 6);
                                    // No reversl detected.
                                    stoploss = step6();
                                    Log.flow(`CS > ${name} > Stop loss price is ${FFF(stoploss)}. Checking volatility...`, 6);
                                    // Stop loss computed.
                                    if (step7()) {
                                        // Volatility is acceptable
                                        Log.flow(`CS > ${name} > Volatility is acceptable. Buy signal confirmed.`, 6);
                                        buy = true;
                                        desc = "Confirmed Buy"
                                    }
                                    else {
                                        Log.flow(`CS > ${name} > Volatility out of range.`, 6);
                                    }
                                }
                                else {
                                    Log.flow(`CS > ${name} > Trend reversal detected.`, 6);
                                }
                            }
                            else {
                                Log.flow(`CS > ${name} > Token is overbought.`, 6);
                            }
                        }
                        else {
                            Log.flow(`CS > ${name} > Strength not acceptable.`, 6);
                        }
                    }
                    else {
                        Log.flow(`CS > ${name} > Trend not confirmed.`, 6);
                    }
                }
                else {
                    Log.flow(`CS > ${name} > No entry detected.`, 6);
                }

                let stopLossPrice = stoploss < latestRate ? stoploss : (latestRate - (stoploss - latestRate));
                cache = Object.fromEntries(Object.entries(cache).filter(([__dirname, v]) => v !== null));

                CandlestickEngine.#multilayer(name, mint, buy, sell, desc, latestRate, ts)
                const signals = CandlestickEngine.#getMLSignalHistory(mint);
                CandlestickEngine.#collector(mint, latestRate, signals[signals.length - 1], buy, sell, stopLossPrice, desc, cache);
                const { nbuy, nsell } = CandlestickEngine.#correctSignals(signals, buy, sell, desc);
                if ((buy && !nbuy) || (sell && !nsell)) {
                    desc = "No Signal";
                }
                buy = nbuy;
                sell = nsell;
                Log.flow(`CE > ${name} > ${desc} > SL: ${FFF(stopLossPrice)} | Mark: ${FFF(latestRate)}.`, 6);
                if ((buy || sell) && ((Date.now() - (CandlestickEngine.#emitTS[mint] || 0)) >= (Site.IND_CFG.CP || 60000))) {
                    CandlestickEngine.#emitTS[mint] = Date.now();
                    SignalManager.entry(mint, buy, sell, desc, stopLossPrice);
                    if (buy) {
                        if (!CSBuy) {
                            CSBuy = require("./cs_buy");
                        }
                        CSBuy.entry(name, mint, desc, latestRate, stopLossPrice);
                    }
                }
                resolve({
                    rate: latestRate,
                    signal: signals[signals.length - 1] || "",
                    buy,
                    sell,
                    sl: stopLossPrice,
                    desc,
                    extra: cache,
                });
            }
            else {
                Log.flow(`CE > ${name} > Not enough candlestick data (${data.length} / ${Site.IND_CFG.MLN || 10}).`, 6);
                resolve({
                    rate: 0,
                    signal: "",
                    buy: false,
                    sell: false,
                    sl: 0,
                    desc: "",
                    extra: {},
                });
            }
        });
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
        // return { nbuy, nsell };
        let lastSig = signals[signals.length - 1];
        if (buy) {
            nbuy = lastSig == "BDNP"
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
                if (Site.IND_CFG.MCLD && (!Site.PRODUCTION)) {
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
     * @param {any} extra
     */
    static #collector = (
        mint,
        rate,
        signal,
        buy,
        sell,
        sl,
        desc,
        extra
    ) => {
        if (Site.IND_CFG.MCLD) {
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
                    extra,
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


    static #sending = false;

    static sendCollected = async () => {
        try {
            if (!CandlestickEngine.#sending) {
                CandlestickEngine.#sending = true;
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
                CandlestickEngine.#sending = false;
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
        if (history.length > (Site.IND_CFG.MSHL || 10)) {
            history = history.slice(history.length - (Site.IND_CFG.MSHL || 10));
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
            if (CandlestickEngine.#signalHistory[mint].length > (Site.IND_CFG.MSHL || 10)) {
                CandlestickEngine.#signalHistory[mint] = CandlestickEngine.#signalHistory[mint].slice(CandlestickEngine.#signalHistory[mint].length - (Site.IND_CFG.MSHL || 10));
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