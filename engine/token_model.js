const Site = require("../env");
const getTimeElapsed = require("../lib/get_time_elapsed");
const CandlestickEngine = require("./candlestick");

class LimitOrder {
    /**
     * Type of limit order
     * @type {'buy'|'sell'}
     */
    type;

    /**
     * Marketcap limit
     * @type {number}
     */
    marketcap;

    /**
     * Amount of token or capital
     * @type {number}
     */
    amount;

    /**
     * Optional min time required in ms before limit order can be executed
     * @type {number}
     */
    min_time;

    /**
     * Optional max time required in ms before limit order can be executed
     * @type {number}
     */
    max_time;

    /**
     * Optional stop loss percentage to be used as reference for trailing stop loss
     * @type {number}
     */
    perc;

    /**
     * Boolean to specify if the limit order is a trailing stop loss
     * @type {boolean}
     */
    trailing;

    /**
     * Min allowable sell PnL for trailing stop loss orders
     * @type {number}
     */
    min_sell_pnl;

    /**
     * Max allowable sell PnL for trailing stop loss orders
     * @type {number}
     */
    max_sell_pnl;

    /**
     * Class constructor
     */
    constructor() {
        this.min_time = 0;
        this.max_time = 0;
        this.perc = 0;
        this.trailing = false;
        this.min_sell_pnl = Number.MIN_VALUE;
        this.max_sell_pnl = Number.MAX_VALUE;
    }
}

class OHLCV {
    /**
     * Open price
     * @type {number}
     */
    open;
    /**
     * High price
     * @type {number}
     */
    high;
    /**
     * Low price
     * @type {number}
     */
    low;
    /**
     * Close price
     * @type {number}
     */
    close;
    /**
     * Volume
     * @type {number}
     */
    volume;
    /**
     * Class constructor
     * @param {number} open
     * @param {number} high
     * @param {number} low
     * @param {number} close
     * @param {number} volume
     */
    constructor(open, high, low, close, volume) {
        this.open = open || close;
        this.high = high || close;
        this.low = low || close;
        this.close = close;
        this.volume = volume || 0;
    }
}

class Token {
    /**
     * Name of the token.
     * @type {string}
     */
    name;

    /**
     * Contract address of the token
    * @type {string}
    */
    mint;

    /**
     * Ticker of the token
    * @type {string}
    */
    symbol;

    /**
     * Current market price of the token in SOL
     * @type {number}
     */
    current_price;

    /**
     * Current marketcap of the token in SOL
     * @type {number}
     */
    current_marketcap;

    /**
     * Price history of the token
     * @type {OHLCV[]}
     */
    price_history;

    /**
     * Epoch timestamp of last updated
     * @type {number}
     */
    last_updated;

    /**
     * Amount of the token currently being held
     * @type {number}
     */
    amount_held;

    /**
     * Pending limit orders
     * @type {LimitOrder[]}
     */
    pending_orders;

    /**
     * Referenc to the interval that backs up price
     * @type {NodeJS.Timeout|null}
     */
    timeout_ref;

    /**
     * Reference to the function that removes the token
     * @type {Function|null}
     */
    remove_ref;

    /**
     * First signal
     * @type {boolean}
     */
    first_signal;

    /**
     * Temporary attribute
     * @type {number}
     */
    temp_open;

    /**
     * Temporary attribute
     * @type {number}
     */
    temp_high;

    /**
     * Temporary attribute
     * @type {number}
     */
    temp_low;

    /**
     * Temporary attribute
     * @type {number}
     */
    temp_volume;

    /**
     * Total amount of base currency i used to Buy
     * @type {number}
     */
    total_bought_base;

    /**
     * Total amount of base i got after selling
     * @type {number}
     */
    total_sold_base;

    /**
     * Recommend buying
     * @type {boolean}
     */
    rec_buy;

    /**
     * Recommend selling
     * @type {boolean}
     */
    rec_sell;

    /**
     * Epoch timestamp of registration
     * @type {number}
     */
    reg_timestamp;

    /**
     * Max marketcap
     * @type {number}
     */
    max_marketcap;

    /**
     * Min marketcap
     * @type {number}
     */
    min_marketcap;

    /**
     * Peak price
     * @type {number}
     */
    peak_price;

    /**
     * Least price
     * @type {number}
     */
    least_price;

    /**
     * Token description
     * @type {string}
     */
    description;

    /**
     * Array of index of all the peak drop conditions executed
     * @type {number[]}
     */
    executed_peak_drops;

    /**
     * Array of index of all the whale exits executed
     * @type {number[]}
     */
    executed_whale_exits;

    /**
     * Flag to indicate if peak drop exit is enabled for this token
     * @type {boolean}
     */
    peak_drop_enabled;

    /**
     * Holds current recorded PnL in BASE
     * @type {number}
     */
    pnl_base;

    /**
     * Holds current recorded PnL percentage
     * @type {number}
     */
    pnl;

    /**
     * Holds maximum recorded PnL percentage
     * @type {number}
     */
    max_pnl;

    /**
     * Holds minimum recorded PnL percentage
     * @type {number}
     */
    min_pnl;

    /**
     * Indicates if the token has been bought for the first time;
     */
    bought_once;

    /**
     * Register source
     * @type {'Telegram'|'Kiko'|'Unspecified'|'Recovery'}
     */
    source;

    /**
     * Indicates if it was added in simulation
     * @type {boolean}
     */
    added_in_simulation;

    /**
     * Exit reasons
     * @type {Set<string>}
     */
    exit_reasons;

    /**
     * Indicates if the token's last buy was a CSBuy
     * @type {boolean};
     */
    CSB;

    /**
     * Temporary Stop Loss Price placeholder
     * @type {number}
     */
    SLP;

    /**
     * Temporary Mark Price placeholder
     * @type {number}
     */
    MP;

    /**
     * Stores trading fees used
     * @type {number}
     */
    fees;

    /**
     * Entry reasons
     * @type {Set<string>}
     */
    entry_reasons;

    /**
     * Constructor for Trade object.
     * @param {string} name 
     * @param {string} symbol 
     * @param {string} mint
     * @param {'Telegram'|'Kiko'|'Unspecified'|'Recovery'} source
     * @param {number} amount_held
     */
    constructor(name, symbol, mint, description, source, amount_held = 0) {
        this.name = name;
        this.symbol = symbol;
        this.mint = mint;
        this.source = source;
        this.added_in_simulation = Site.SIMULATION;
        this.description = description;
        this.current_price = 0;
        this.max_marketcap = 0;
        this.min_marketcap = 0;
        this.peak_price = 0;
        this.least_price = 0;
        this.current_marketcap = 0;
        this.price_history = [];
        this.last_updated = Date.now();
        this.amount_held = amount_held;
        this.pending_orders = [];
        this.remove_ref = null;
        this.temp_high = 0;
        this.temp_low = 0;
        this.temp_volume = 0;
        this.fees = 0;
        this.temp_open = 0;
        this.total_bought_base = 0;
        this.total_sold_base = 0;
        this.rec_buy = false;
        this.rec_sell = false;
        this.first_signal = false;
        this.reg_timestamp = Date.now();
        this.bought_once = amount_held != 0;
        this.executed_peak_drops = [];
        this.executed_whale_exits = [];
        this.peak_drop_enabled = Site.AU_AUTO_PEAKDROP;
        this.pnl_base = 0;
        this.pnl = 0;
        this.entry_reasons = new Set();
        this.exit_reasons = new Set();
        this.CSB = false;
        this.SLP = 0;
        this.MP = 0;
        this.max_pnl = 0;
        this.min_pnl = 0;
        this.timeout_ref = setInterval(() => {
            if (this.current_price != 0) {
                let obj = new OHLCV(this.temp_open, this.temp_high, this.temp_low, this.current_price, this.temp_volume || (this.price_history[this.price_history.length - 1] || {}).volume);
                this.temp_open = 0;
                this.temp_high = 0;
                this.temp_low = 0;
                this.temp_volume = 0;
                this.price_history.push(obj);
                CandlestickEngine.entry(this.name, this.mint, this.price_history);
            }
            if (this.price_history.length > Site.COL_MAX_LENGTH) {
                this.price_history = this.price_history.slice(this.price_history.length - Site.COL_MAX_LENGTH);
            }
            const elapsed = Date.now() - this.last_updated;
            if (elapsed >= Site.COL_INACTIVITY_TIMEOUT_MS && this.amount_held <= 0) {
                if (this.remove_ref) {
                    this.remove_ref(this.mint);
                }
            }
        }, Site.COL_DURATION_MS);
    }

}

module.exports = { Token, OHLCV, LimitOrder };