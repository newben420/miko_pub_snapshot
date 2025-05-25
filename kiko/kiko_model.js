const { buy } = require("../engine/token");
const { OHLCV } = require("../engine/token_model");
const Site = require("../env");
const FFF = require("../lib/fff");
const formatNumber = require("../lib/format_number");
const getTimeElapsed = require("../lib/get_time_elapsed");
let SocketEngine = null;

class ObserverToken {

    /**
     * @type {string}
     */
    name;

    /**
     * @type {string}
     */
    mint;

    /**
     * @type {string}
     */
    symbol;

    /**
     * @type {string}
     */
    description;

    /**
     * @type {string}
     */
    developer;

    /**
     * @type {string}
     */
    uri;

    /**
     * @type {number}
     */
    reg_timestamp;

    /**
     * @type {number}
     */
    marketcapSol;

    /**
     * @type {number}
     */
    buys;

    /**
     * @type {number}
     */
    sells;

    /**
     * @type {number}
     */
    buy_volume_sol;

    /**
     * @type {number}
     */
    sell_volume_sol;

    /**
     * @type {Record<string, number>}
     */
    holders;

    /**
     * @type {number}
     */
    last_updated;

    /**
     * @type {number}
     */
    price;

    /**
     * Price history of the token
     * @type {OHLCV[]}
     */
    price_history;

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
     * Referenc to the interval that backs up price
     * @type {NodeJS.Timeout|null}
     */
    timeout_ref;

    /**
     * @type {number}
     */
    dev_initial_buy;

    /**
     * @type {number}
     */
    circulating_supply;

    /**
     * @type {string}
     */
    remove_remark;

    /**
     * @type {NodeJS.Timeout}
     */
    inactivity_obj_ref;

    /**
     * @type {Function}
     */
    remove_ref;

    /**
     * @type {Function}
     */
    audit_ref;

    /**
     * @type {boolean}
     */
    audited;

    /**
     * @type {any}
     */
    audit_result;

    /**
     * @type {boolean}
     */
    audit_in_progress;

    /**
     * @type {number}
     */
    audit_timestamp;

    /**
     * @type {number}
     */
    number_of_audits;

    /**
     * @type {number}
     */
    bonding_progress;

    getGraduateData = () => {
        return structuredClone({
            name: this.name,
            mint: this.mint,
            symbol: this.symbol,
            description: this.description,
            developer: this.developer,
            uri: this.uri,
            raw_audit_data: (this.audit_result || {}).raw || {},
            human_audit_data: { ...((this.audit_result || {}).human || {}), 'Observe Time': getTimeElapsed(this.reg_timestamp, Date.now()) },
            price_history: this.price_history,
        });
    }

    /**
     * Class constructor
     * @param {any} message 
     * @param {Function} removeRef
     * @param {Function} auditRef
     */
    constructor(message, removeRef, auditRef) {
        const { name, symbol, mint, traderPublicKey, uri, marketCapSol, solAmount, initialBuy, vSolInBondingCurve } = message;
        this.name = name || "";
        this.mint = mint || "";
        this.symbol = symbol || "";
        this.price_history = [];
        this.description = "";
        this.developer = traderPublicKey || "";
        this.uri = uri || "";
        this.reg_timestamp = Date.now();
        this.marketcapSol = parseFloat(marketCapSol) || 0;
        if (solAmount) {
            this.buys = 1;
            this.buy_volume_sol = parseFloat(solAmount) || 0;
        }
        else {
            this.buys = 0;
            this.buy_volume_sol = 0;
        }
        if (solAmount && initialBuy && marketCapSol) {
            let sa = parseFloat(solAmount) || 0;
            let ib = parseFloat(initialBuy || 0);
            let mc = parseFloat(marketCapSol || 0);
            this.price = (sa / ib) || 0;
            this.circulating_supply = (mc / this.price) || 0;
        }
        else {
            this.price = 0;
            this.circulating_supply = 0;
        }
        this.sells = 0;
        this.sell_volume_sol = 0;
        this.holders = {};
        if (initialBuy) {
            this.holders[this.developer] = parseFloat(initialBuy) || 0;
            this.dev_initial_buy = this.holders[this.developer];
        }
        else {
            this.dev_initial_buy = 0;
        }
        this.bonding_progress = ((parseFloat(vSolInBondingCurve || "0") || 0) / 115) * 100;
        this.remove_ref = removeRef || (() => { });
        this.audit_ref = auditRef || (() => { });
        this.remove_remark = "Inactivity";
        this.number_of_audits = 0;
        this.audited = false;
        this.audit_in_progress = false;
        this.audit_timestamp = 0;
        this.audit_result = null;
        this.last_updated = Date.now();
        this.temp_open = this.price;
        this.temp_high = this.price;
        this.temp_low = this.price;
        this.temp_volume = this.buy_volume_sol + this.sell_volume_sol;
        this.inactivity_obj_ref = setInterval(() => {
            const timeSinceLU = Date.now() - (this.last_updated || 0);
            if (timeSinceLU >= Site.OB_TOKEN_INACTIVITY_TIMEOUT) {
                this.remove_remark = "Inactivity";
                this.remove_ref(this.mint);
            }
        }, Site.OB_TOKEN_INACTIVITY_INTERVAL);
        this.timeout_ref = setInterval(() => {
            if (this.price) {
                let obj = new OHLCV(this.temp_open, this.temp_high, this.temp_low, this.price, this.temp_volume || (this.price_history[this.price_history.length - 1] || {}).volume || 0, Date.now());
                this.temp_open = 0;
                this.temp_high = 0;
                this.temp_low = 0;
                this.temp_volume = 0;
                this.price_history.push(obj);
            }
            if (this.price_history.length > Site.COL_MAX_LENGTH) {
                this.price_history = this.price_history.slice(this.price_history.length - Site.COL_MAX_LENGTH);
            }
        }, Site.COL_DURATION_MS);
    }

    /**
     * Called before this object is destroyed
     * @returns {Promise<boolean>}
     */
    internalDestroy() {
        return new Promise((resolve, reject) => {
            if (this.audit_in_progress) {
                resolve(false);
            }
            else {
                if (this.inactivity_obj_ref) {
                    clearInterval(this.inactivity_obj_ref);
                }
                if (this.timeout_ref) {
                    clearInterval(this.timeout_ref);
                }
                resolve(true);
            }
        })
    }

    /**
     * called To trigger audit on this token
     */
    triggerAudit = async () => {
        if (!this.audit_in_progress) {
            this.audit_in_progress = true;
            let result = await this.audit_ref(this);
            if (result) {
                this.audit_result = result;
                this.audit_timestamp = Date.now();
                this.number_of_audits++;
                if (!this.audited) {
                    // newly audited token
                    if (Site.UI) {
                        if (!SocketEngine) {
                            SocketEngine = require("../engine/socket");
                        }
                        SocketEngine.sendKiko(null, {
                            audited: {
                                [this.mint]: {
                                    name: this.name || "",
                                    symbol: this.symbol || "",
                                    regTimestamp: this.reg_timestamp || Date.now(),
                                    auditTimestamp: this.audit_timestamp || Date.now(),
                                    auditCount: this.number_of_audits || 0,
                                    bonding: this.bonding_progress || 0,
                                    mint: this.mint || "",
                                }
                            }
                        }, false);
                    }
                }
                else {
                    // already audited token
                    if (Site.UI) {
                        if (!SocketEngine) {
                            SocketEngine = require("../engine/socket");
                        }
                        SocketEngine.sendKiko(null, {
                            audited: {
                                [this.mint]: {
                                    auditTimestamp: this.audit_timestamp || Date.now(),
                                    auditCount: this.number_of_audits || 0,
                                }
                            }
                        }, false);
                    }
                }
                this.audited = true;
            }
            else {
                this.audited = false;
            }
            this.audit_in_progress = false;
        }
    }
}

class AuditData {

    /**
     * @type {boolean}
     */
    dev_other_tokens;

    /**
     * @type {number}
     */
    dev_other_tokens_pass_perc;

    /**
     * @type {boolean}
     */
    dev_sold_some;

    /**
     * @type {number}
     */
    dev_sold_perc;

    /**
     * @type {number}
     */
    dev_hold_perc;

    /**
     * @type {number}
     */
    replies_count;

    /**
     * @type {number}
     */
    replies_unique_repliers_perc;

    /**
     * @type {number}
     */
    replies_unique_score;

    /**
     * @type {number}
     */
    holders_count;

    /**
     * @type {number}
     */
    holders_top_perc;

    /**
     * @type {number}
     */
    holders_sus_score;

    /**
     * @type {boolean}
     */
    social_telegram;

    /**
     * @type {boolean}
     */
    social_website;

    /**
     * @type {boolean}
     */
    social_twitter;

    /**
     * @type {number}
     */
    marketcap;

    /**
    * @type {number}
    */
    volume;

    /**
    * @type {number}
    */
    trades;

    /**
    * @type {number}
    */
    buy_perc;

    /**
    * @type {number}
    */
    buy_vol_perc;

    /**
     * @type {any[]}
     */
    top_holders;

    /**
     * Converts object to a normal JS object
     * @returns {Record<string, any>}
     */
    toRawObject() {
        let obj = this;
        return {
            dev_other_tokens: obj.dev_other_tokens || false,
            dev_other_tokens_pass_perc: obj.dev_other_tokens_pass_perc || 0,
            dev_sold_some: obj.dev_sold_some || false,
            dev_sold_perc: obj.dev_sold_perc || 0,
            dev_hold_perc: obj.dev_hold_perc || 0,
            replies_count: obj.replies_count || 0,
            replies_unique_repliers_perc: obj.replies_unique_repliers_perc || 0,
            replies_unique_score: obj.replies_unique_score || 0,
            holders_count: obj.holders_count || 0,
            holders_top_perc: obj.holders_top_perc || 0,
            holders_sus_score: obj.holders_sus_score || 0,
            social_telegram: obj.social_telegram || false,
            social_twitter: obj.social_twitter || false,
            social_website: obj.social_website || false,
            marketcap: obj.marketcap || 0,
            volume: obj.volume || 0,
            trades: obj.trades || 0,
            buy_perc: obj.buy_perc || 0,
            buy_vol_perc: obj.buy_vol_perc || 0,
            top_holders: obj.top_holders || [],
        };
    }

    /**
     * Converts object to a human-readable JS record
     * @returns {Record<string, any>}
     */
    toReadableRecord() {
        /**
         * @type {Record<string, any>}
         */
        let obj = {};
        if (this.marketcap !== null) {
            obj[`Marketcap`] = `${Site.BASE_DENOMINATED ? Site.BASE : 'USD'} ${FFF(this.marketcap)}`;
        }
        if (this.volume !== null) {
            obj[`Volume`] = `${Site.BASE_DENOMINATED ? Site.BASE : 'USD'} ${FFF(this.volume)}`;
        }
        if (this.dev_other_tokens !== null && this.dev_other_tokens_pass_perc !== null) {
            obj[`Dev Other Tokens`] = `${this.dev_other_tokens ? `Yes (${this.dev_other_tokens_pass_perc.toFixed(2)}%)` : `No`}`;
        }
        if (this.dev_sold_perc !== null && this.dev_sold_some !== null) {
            obj[`Dev Sold`] = `${this.dev_sold_some ? `Yes (${this.dev_sold_perc.toFixed(2)}%)` : "No"}`;
        }
        if (this.dev_hold_perc !== null) {
            obj[`Dev Hold`] = `${this.dev_hold_perc.toFixed(2)}%`;
        }
        if (this.replies_count !== null && this.replies_unique_repliers_perc !== null && this.replies_unique_score !== null) {
            obj[`Replies`] = `${formatNumber(this.replies_count)}`;
            obj[`Repliers Unique`] = `${this.replies_unique_repliers_perc.toFixed(2)}%`;
            obj[`Replies U. Score`] = `${this.replies_unique_score.toFixed(2)}`;
        }
        if (this.holders_count !== null && this.holders_sus_score !== null && this.holders_top_perc !== null) {
            obj[`Holders`] = `${formatNumber(this.holders_count)}`;
            obj[`Holders Top ${Math.min(10, this.holders_count)}`] = `${this.holders_top_perc.toFixed(2)}%`;
            obj[`Holders S. Score`] = `${this.holders_sus_score.toFixed(2)}`;
        }
        if (this.social_telegram !== null && this.social_twitter !== null && this.social_website !== null) {
            obj[`Twitter`] = `${this.social_twitter ? `Yes` : `No`}`;
            obj[`Telegram`] = `${this.social_telegram ? `Yes` : `No`}`;
            obj[`Website`] = `${this.social_website ? `Yes` : `No`}`;
        }
        if (this.trades != null && this.buy_perc != null && this.buy_vol_perc != null) {
            obj[`Trades`] = `${formatNumber(this.trades)}`;
            obj[`Buys`] = `${this.buy_perc.toFixed(2)}%`;
            obj[`Buy Vol`] = `${this.buy_vol_perc.toFixed(2)}%`;

        }
        return obj;
    }

    constructor() {
        this.dev_other_tokens = null;
        this.dev_other_tokens_pass_perc = null;
        this.dev_sold_some = null;
        this.dev_sold_perc = null;
        this.dev_hold_perc = null;
        this.replies_count = null;
        this.replies_unique_repliers_perc = null;
        this.replies_unique_score = null;
        this.holders_count = null;
        this.holders_top_perc = null;
        this.holders_sus_score = null;
        this.social_telegram = null;
        this.social_twitter = null;
        this.social_website = null;
        this.marketcap = null;
        this.volume = null;
        this.trades = null;
        this.buy_perc = null;
        this.buy_vol_perc = null;
        this.top_holders = null;
    }
}

module.exports = { ObserverToken, AuditData };