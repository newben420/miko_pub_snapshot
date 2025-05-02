const { config } = require("dotenv");
const args = process.argv.slice(2);
config({
    path: args[0] || ".env"
});
const json_safe_parse = require("./lib/json_safe_parse");
const { Keypair } = require("@solana/web3.js");
const keyArray = json_safe_parse(process.env.DE_LOCAL_KEYPAIR ?? "[]", true);
const key = new Uint8Array(keyArray);
const keypair = Keypair.fromSecretKey(key);
const path = require("path");
const rootDir = require("./root");
const Regex = require("./lib/regex");

/**
 * This class handles application configurations and parses env data into the right types and format.
 */
const HOLDERS_RANGE = (process.env.GR_AUDIT_HOLDERS_RANGE || "").split(" ").filter(x => x.length > 0).map(x => parseInt(x)).filter(x => !Number.isNaN(x));
const TRADES_RANGE = (process.env.GR_AUDIT_TRADES_RANGE || "").split(" ").filter(x => x.length > 0).map(x => parseInt(x)).filter(x => !Number.isNaN(x));
const BUY_PERC_RANGE = (process.env.GR_AUDIT_BUY_PERC_RANGE || "").split(" ").filter(x => x.length > 0).map(x => parseInt(x)).filter(x => !Number.isNaN(x));
const BUY_VOL_PERC_RANGE = (process.env.GR_AUDIT_BUY_VOL_PERC_RANGE || "").split(" ").filter(x => x.length > 0).map(x => parseInt(x)).filter(x => !Number.isNaN(x));

class Site {
    static TITLE = process.env.TITLE ?? "STEGEN";
    static PORT = parseInt(process.env.PORT || "5000");
    static PRODUCTION = process.env.PRODUCTION == "true";
    static MAX_FLOW_LOG_WEIGHT = parseInt(process.env.MAX_FLOW_LOG_WEIGHT || "5");
    static BASE = process.env.BASE ?? "SOL";
    static BASE_DENOMINATED = process.env.BASE_DENOMINATED == "true";
    static URL = Site.PRODUCTION ? (process.env.URL_PRODUCTION || "") : `http://localhost:${Site.PORT}`;
    static AUTO_RECOVERY = process.env.AUTO_RECOVERY == "true";
    static SIMULATION = process.env.SIMULATION == "true";
    static FORCE_FAMILY_4 = process.env.FORCE_FAMILY_4 == "true";
    static EXIT_ON_EXCEPTION = process.env.EXIT_ON_EXCEPTION == "true";
    static EXIT_ON_REJECTION = process.env.EXIT_ON_REJECTION == "true";
    static BUY_ALERT = process.env.BUY_ALERT == "true";
    static SELL_ALERT = process.env.SELL_ALERT == "true";
    static MIN_MARKET_CAP = parseFloat(process.env.MIN_MARKET_CAP || "0");

    static HTTP_TIMEOUT = parseInt(process.env.HTTP_TIMEOUT || "30000");
    static WS_URL = process.env.WS_URL ?? "";
    static WS_RECONNECTION_DELAY = parseInt(process.env.WS_RECONNECTION_DELAY || "3000");
    static PF_API = process.env.PF_API ?? "https://frontend-api.pump.fun";
    static SOLPRICE_INTERVAL_MS = parseInt(process.env.SOLPRICE_INTERVAL_MS || "60000");
    static DEFAULT_SOL_USD_PRICE = parseFloat(process.env.DEFAULT_SOL_USD_PRICE || "100");
    static TOKEN_PROGRAM_ID = process.env.TOKEN_PROGRAM_ID ?? "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
    static STRING_SHORT_CODE_LENGTH = parseInt(process.env.STRING_SHORT_CODE_LENGTH || "8");

    static DE_SLIPPAGE_PERC_ENTRY = parseFloat(process.env.DE_SLIPPAGE_PERC_ENTRY || "0");
    static DE_SLIPPAGE_PERC_EXIT = parseFloat(process.env.DE_SLIPPAGE_PERC_EXIT || "0");
    static DE_POOL = process.env.DE_POOL ?? "auto";
    static DE_INACTIVITY_INTERVAL_MS = parseInt(process.env.DE_INACTIVITY_INTERVAL_MS || "4000");
    static DE_INACTIVITY_TIMEOUT_MS = parseInt(process.env.DE_INACTIVITY_TIMEOUT_MS || "10000");
    static DE_BUY_AMOUNTS_SOL = (process.env.DE_BUY_AMOUNTS_SOL || "0.1 0.5 1 2 5 10").split(" ").filter(x => x.length > 0).map(x => parseFloat(x)).filter(x => ((!Number.isNaN(x)) ? (x > 0) : false));
    static DE_SELL_PERCS_SOL = (process.env.DE_SELL_PERCS_SOL || "25 50 100").split(" ").filter(x => x.length > 0).map(x => parseInt(x)).filter(x => ((!Number.isNaN(x)) ? (x > 0) : false));

    static COL_DURATION_MS = parseInt(process.env.COL_DURATION_MS || "60000") || 60000;
    static COL_MAX_LENGTH = parseInt(process.env.COL_MAX_LENGTH || "100") || 100;
    static COL_MULTIPLES_MS_ARR = (process.env.COL_MULTIPLES_MS_ARR || "60000").split(" ").filter(x => x.length > 0).map(x => parseInt(x)).filter(x => (Number.isInteger(x) ? (x >= Site.COL_DURATION_MS) : false));
    static COL_INACTIVITY_TIMEOUT_MS = parseInt(process.env.COL_INACTIVITY_TIMEOUT_MS || "36000000") || 36000000;
    static COLLECTOR_AUTO_TOKENS = (process.env.COLLECTOR_AUTO_TOKENS || "").split(" ").filter(x => Regex.mint.test(x));

    static AU_SELL = (process.env.AU_SELL || "").split("|").filter(x => x.length > 0).map(x => x.split(" ").filter(y => y.length > 0).map(y => parseFloat(y)).filter(y => !Number.isNaN(y))).filter(x => x.length >= 2 && x.length <= 5).map(x => ({ pnl: x[0], perc: x[1], trailing: (x[2] || 0) > 0, minPnL: x[3] ?? Number.MIN_VALUE, maxPnL: x[4] || Number.MAX_VALUE })).filter(x => x.pnl != 0 && x.perc >= 1 && x.perc <= 100);
    static AU_BUY = (process.env.AU_BUY || "").split("|").filter(x => x.length > 0).map(x => x.split(" ").filter(y => y.length > 0).map(y => parseFloat(y)).filter(y => !Number.isNaN(y))).filter(x => x.length == 4).map(x => ({ mc: x[0], buyAmt: x[1], minTime: x[2], maxTime: x[3] })).filter(x => x.buyAmt > 0 && x.minTime >= 0 && x.maxTime >= 0 && (x.maxTime > x.minTime || x.maxTime == 0));
    static AU_PEAKDROP = (process.env.AU_PEAKDROP || "").split("|").filter(x => x.length > 0).map(x => x.split(" ").filter(y => y.length > 0).map(y => parseFloat(y)).filter(y => !Number.isNaN(y))).filter(x => x.length == 4).map(x => ({ minPnLPerc: x[0], maxPnLPerc: x[1], minDropPerc: x[2], sellPerc: x[3] })).filter(x => x.minPnLPerc >= 0 && (x.maxPnLPerc > x.minPnLPerc || x.maxPnLPerc === 0) && x.minDropPerc >= 0 && x.sellPerc >= 1 && x.sellPerc <= 100);
    static AU_BUY_DESC_REQUIRED = (process.env.AU_BUY_DESC_REQUIRED || "").toLowerCase() == "true";
    static AU_AUTO_SELL = (process.env.AU_AUTO_SELL || "").toLowerCase() == "true";
    static AU_AUTO_BUY = (process.env.AU_AUTO_BUY || "").toLowerCase() == "true";
    static AU_AUTO_PEAKDROP = (process.env.AU_AUTO_PEAKDROP || "").toLowerCase() == "true";

    static IND_MIN_LENGTH = parseInt(process.env.IND_MIN_LENGTH || "10") || 10;
    static IND_MACD_FAST_PERIOD = parseInt(process.env.IND_MACD_FAST_PERIOD || "12") || 12;
    static IND_MACD_SLOW_PERIOD = parseInt(process.env.IND_MACD_SLOW_PERIOD || "26") || 26;
    static IND_MACD_SIGNAL_PERIOD = parseInt(process.env.IND_MACD_SIGNAL_PERIOD || "9") || 9;
    static IND_MA_PERIOD = parseInt(process.env.IND_MA_PERIOD || "10") || 10;
    static IND_AO_FAST_PERIOD = parseInt(process.env.IND_AO_FAST_PERIOD || "5") || 5;
    static IND_AO_SLOW_PERIOD = parseInt(process.env.IND_AO_SLOW_PERIOD || "34") || 34;
    static IND_FI_PERIOD = parseInt(process.env.IND_FI_PERIOD || "14") || 14;
    static IND_BB_PERIOD = parseInt(process.env.IND_BB_PERIOD || "20") || 20;
    static IND_BB_STDDEV = parseFloat(process.env.IND_BB_STDDEV || "2") || 2;
    static IND_PSAR_STEP = parseFloat(process.env.IND_PSAR_STEP || "0.02") || 0.02;
    static IND_PSAR_MAX = parseFloat(process.env.IND_PSAR_MAX || "0.2") || 0.2;
    static IND_STOCH_PERIOD = parseInt(process.env.IND_STOCH_PERIOD || "14") || 14;
    static IND_STOCH_SIGNAL_PERIOD = parseInt(process.env.IND_STOCH_SIGNAL_PERIOD || "3") || 3;
    static IND_DIR_LENGTH = parseInt(process.env.IND_DIR_LENGTH || "5") || 5;
    static IND_TREND_SUPPORT_THRESHOLD_RATIO = parseFloat(process.env.IND_TREND_SUPPORT_THRESHOLD_RATIO || "0.5") || 0.5;
    static IND_MAX_SIGNAL_HISTORY_LENGTH = parseInt(process.env.IND_MAX_SIGNAL_HISTORY_LENGTH || "5") || "5";

    static DE_LOCAL_URL = process.env.DE_LOCAL_URL ?? "";
    static DE_LOCAL_PUB_KEY = keypair.publicKey.toBase58();
    static DE_LOCAL_KEYPAIR = keypair;

    static TG_TOKEN = process.env.TG_TOKEN ?? "";
    static TG_CHAT_ID = parseInt(process.env.TG_CHAT_ID ?? "0");
    static TG_POLLING = process.env.TG_POLLING == "true";
    static TG_SEND_START = process.env.TG_SEND_START == "true";
    static TG_SEND_STOP = process.env.TG_SEND_STOP == "true";
    static TG_SEND_AUDIT_FAILED = process.env.TG_SEND_AUDIT_FAILED == "true";
    static TG_WH_SECRET_TOKEN = process.env.TG_WH_SECRET_TOKEN ?? "";
    static TG_MESSAGE_DURATION_MS = parseInt(process.env.TG_MESSAGE_DURATION_MS || "5000") || 5000;
    static TG_BOT_URL = process.env.TG_BOT_URL ?? "";

    static EX_QUICKNODE = process.env.EX_QUICKNODE ?? "";
    static EX_RPC = process.env.EX_RPC ?? "";
    static IND_ML_COLLECT_DATA = process.env.IND_ML_COLLECT_DATA == "true";
    static IND_ML_DATA_PATH = Site.IND_ML_COLLECT_DATA ? (path.join(rootDir(), `ml_${process.env.IND_ML_DATA_PATH || "default"}.json`)) : "";


    static IPFS_GATEWAY_HOST = process.env.IPFS_GATEWAY_HOST ?? "gateway.pinata.cloud";

    static LA_NAME_REGEX = new RegExp(process.env.LA_NAME_REGEX || ".*");
    static LA_SYMBOL_REGEX = new RegExp(process.env.LA_SYMBOL_REGEX || ".*");
    static LA_POOL = process.env.LA_POOL || "auto";
    static LA_NAME_SYMBOL_BLACKLIST = new RegExp((process.env.LA_NAME_SYMBOL_BLACKLIST ?? "").toLowerCase().split(" ").filter(x => x.length > 0 && /^[a-z0-9]+$/.test(x)).join("|"));
    static LA_NAME_SYMBOL_WHITELIST = new RegExp((process.env.LA_NAME_SYMBOL_WHITELIST ?? "").toLowerCase().split(" ").filter(x => x.length > 0 && /^[a-z0-9]+$/.test(x)).join("|") || ".*");
    static LA_NAME_SYMBOL_WHITELIST_LENGTH = (process.env.LA_NAME_SYMBOL_WHITELIST ?? "").toLowerCase().split(" ").filter(x => x.length > 0 && /^[a-z0-9]+$/.test(x)).length;

    static OB_MAX_TOKENS = parseInt(process.env.OB_MAX_TOKENS || "0") || Infinity;
    static OB_TOKEN_INACTIVITY_INTERVAL = parseInt(process.env.OB_TOKEN_INACTIVITY_INTERVAL || "0") || 5000;
    static OB_TOKEN_INACTIVITY_TIMEOUT = parseInt(process.env.OB_TOKEN_INACTIVITY_TIMEOUT || "0") || 60000;
    static OB_AUDIT_BD_PROGRESS = parseInt(process.env.OB_AUDIT_BD_PROGRESS || "50") || 50;
    static OB_GRADUATE_BD_PROGRESS = parseInt(process.env.OB_GRADUATE_BD_PROGRESS || "98") || 98;
    static OB_AUDIT_VALIDITY_DURATION = parseInt(process.env.OB_AUDIT_VALIDITY_DURATION || "0") || 300000;

    static GR_USE_DUPLICATE_TOKEN_FILTER = (process.env.GR_USE_DUPLICATE_TOKEN_FILTER || "").toLowerCase() == "true";
    static GR_DUPLICATE_TOKEN_FILTER_MEM_LENGTH = parseInt(process.env.GR_DUPLICATE_TOKEN_FILTER_MEM_LENGTH || "0") || 100;
    static GR_AUDIT_DEV_OT_REQUIRED = (process.env.GR_AUDIT_DEV_OT_REQUIRED || "").toLowerCase() == "true";
    static GR_AUDIT_DEV_OT_MIN_PERC = parseFloat(process.env.GR_AUDIT_DEV_OT_MIN_PERC || "0") || 0;
    static GR_AUDIT_DEV_CAN_SELL = (process.env.GR_AUDIT_DEV_CAN_SELL || "").toLowerCase() == "true";
    static GR_AUDIT_DEV_MAX_SELL_PERC = parseFloat(process.env.GR_AUDIT_DEV_MAX_SELL_PERC || "100") || 100;
    static GR_AUDIT_DEV_MAX_HOLD_PERC = parseFloat(process.env.GR_AUDIT_DEV_MAX_HOLD_PERC || "100") || 100;
    static GR_AUDIT_REPLIES_MIN = parseInt(process.env.GR_AUDIT_REPLIES_MIN || "0") || 0;
    static GR_AUDIT_REPLIES_REPLIERS_MIN_PERC = parseFloat(process.env.GR_AUDIT_REPLIES_REPLIERS_MIN_PERC || "0") || 0;
    static GR_AUDIT_REPLIES_UNIQUE_SCORE_MIN = parseFloat(process.env.GR_AUDIT_REPLIES_UNIQUE_SCORE_MIN || "0") || 0;
    static GR_AUDIT_HOLDERS_RANGE = { MIN: HOLDERS_RANGE[0] || 0, MAX: HOLDERS_RANGE[1] || Infinity };
    static GR_AUDIT_HOLDERS_TOP_MAX_PERC = parseFloat(process.env.GR_AUDIT_HOLDERS_TOP_MAX_PERC || "100") || 100;
    static GR_AUDIT_HOLDERS_SUSSCORE_MAX = parseFloat(process.env.GR_AUDIT_HOLDERS_SUSSCORE_MAX || "100") || 100;
    static GR_AUDIT_SOCIAL_TWITTER_REQ = (process.env.GR_AUDIT_SOCIAL_TWITTER_REQ || "").toLowerCase() == "true";
    static GR_AUDIT_SOCIAL_TELEGRAM_REQ = (process.env.GR_AUDIT_SOCIAL_TELEGRAM_REQ || "").toLowerCase() == "true";
    static GR_AUDIT_SOCIAL_WEBSITE_REQ = (process.env.GR_AUDIT_SOCIAL_WEBSITE_REQ || "").toLowerCase() == "true";
    static GR_AUDIT_SOCIAL_MIN = parseInt(process.env.GR_AUDIT_SOCIAL_MIN || "0") || 0;
    static GR_AUDIT_TRADES_RANGE = { MIN: TRADES_RANGE[0] || 0, MAX: TRADES_RANGE[1] || Infinity };
    static GR_AUDIT_BUY_PERC_RANGE = { MIN: BUY_PERC_RANGE[0] || 0, MAX: BUY_PERC_RANGE[1] || Infinity };
    static GR_AUDIT_BUY_VOL_PERC_RANGE = { MIN: BUY_VOL_PERC_RANGE[0] || 0, MAX: BUY_VOL_PERC_RANGE[1] || Infinity };

    static AD_DEV_OTHER_TOKENS_MC_THRESHOLD = parseFloat(process.env.AD_DEV_OTHER_TOKENS_MC_THRESHOLD || "0");

    static SIGNATURES_MAX_LENGTH = parseInt(process.env.SIGNATURES_MAX_LENGTH || "0") || 100;
    static TRADE_MAX_RETRIES = parseInt(process.env.TRADE_MAX_RETRIES || "0") || 0;
    static TRADE_RETRY_TIMEOUT_MS = parseInt(process.env.TRADE_RETRY_TIMEOUT_MS || "0") || 10000;
    static TRADE_AUTO_RECOVERY = (process.env.TRADE_AUTO_RECOVERY || "").toLowerCase() == "true";
    static TRADE_SEND_RETRY_NOTIFICATION = (process.env.TRADE_SEND_RETRY_NOTIFICATION || "").toLowerCase() == "true";
    static AUTO_ACCEPT_TOKEN = (process.env.AUTO_ACCEPT_TOKEN || "").toLowerCase() == "true";

    static ZERO_THRESHOLD = parseFloat(process.env.ZERO_THRESHOLD || "0") || 0.1;
}

module.exports = Site;