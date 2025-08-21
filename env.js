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
    static PORT = parseInt(process.env.PORT || "4000");
    static PRODUCTION = process.env.PRODUCTION == "true";
    static UI = (process.env.UI || "").toLowerCase() == "true";
    static TG = (process.env.TG || "").toLowerCase() == "true";
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
    static AU_WHALE_ENTRY = (process.env.AU_WHALE_ENTRY || "").split("|").filter(x => x.length > 0).map(x => x.split(" ").filter(y => y.length > 0).map(y => parseFloat(y)).filter(y => !Number.isNaN(y))).filter(x => x.length == 4).map(x => ({ start: x[0], stop: x[1], minWhales: x[2], minSellPerc: x[3] })).filter(x => x.start >= 0 && x.stop >= x.start && x.minWhales >= 1 && x.minSellPerc >= 1);
    static AU_WHALE_EXIT = (process.env.AU_WHALE_EXIT || "").split("|").filter(x => x.length > 0).map(x => x.split(" ").filter(y => y.length > 0).map(y => parseFloat(y)).filter(y => !Number.isNaN(y))).filter(x => x.length == 7).map(x => ({ start: x[0], stop: x[1], minWhales: x[2], minSellPerc: x[3], minPnL: x[4], maxPnL: x[5] || Infinity, sellPerc: x[6] })).filter(x => x.start >= 0 && x.stop >= x.start && x.minWhales >= 1 && x.minSellPerc >= 1 && x.maxPnL >= x.minPnL && x.sellPerc >= 1 && x.sellPerc <= 100);
    static AU_BUY_DESC_REQUIRED = (process.env.AU_BUY_DESC_REQUIRED || "").toLowerCase() == "true";
    static AU_AUTO_SELL = (process.env.AU_AUTO_SELL || "").toLowerCase() == "true";
    static AU_AUTO_BUY = (process.env.AU_AUTO_BUY || "").toLowerCase() == "true";
    static AU_AUTO_PEAKDROP = (process.env.AU_AUTO_PEAKDROP || "").toLowerCase() == "true";
    static AU_AUTO_WHALE_ENTRY = (process.env.AU_AUTO_WHALE_ENTRY || "").toLowerCase() == "true";
    static AU_AUTO_WHALE_EXIT = (process.env.AU_AUTO_WHALE_EXIT || "").toLowerCase() == "true";

    static IND_CFG = Object.fromEntries((process.env.IND_CFG || "").replace(/[\n\r]/g, " ").split(" ").filter(x => x.length > 0).reduce((acc, val, i, arr) => i % 2 === 0 ? acc : acc.concat([[arr[i - 1], /^true$/i.test(val) ? true : /^false$/i.test(val) ? false : isNaN(val) ? val : val.includes(".") ? parseFloat(val) : parseInt(val)]]), []));

    static STR_ENTRY_IND = process.env.STR_ENTRY_IND || "ICH";
    static STR_TREND_IND = (process.env.STR_TREND_IND || "BLL").split(" ").filter(x => x.length == 3);
    static STR_TREND_CV = parseFloat(process.env.STR_TREND_CV || "0") || 0;
    static STR_TREND_FV = parseFloat(process.env.STR_TREND_FV || "0") || 0;
    static STR_STG_FV = parseFloat(process.env.STR_STG_FV || "0") || 0;
    static STR_OB_IND = (process.env.STR_OB_IND || "STC").split(" ").filter(x => x.length == 3);
    static STR_OB_CV = parseFloat(process.env.STR_OB_CV || "0") || 0;
    static STR_OB_FV = parseFloat(process.env.STR_OB_FV || "0") || 0;
    static STR_REV_IND_BULL = (process.env.STR_REV_IND_BULL || "STR HGM EST TBC PIL DCC TTP").split(" ").filter(x => x.length == 3);
    static STR_REV_IND_BEAR = (process.env.STR_REV_IND_BEAR || "TWS MST HMR TBT").split(" ").filter(x => x.length == 3);
    static STR_REV_CV = parseFloat(process.env.STR_REV_CV || "0") || 0;
    static STR_REV_FV = parseFloat(process.env.STR_REV_FV || "0") || 0;
    static STR_TSL_IND = process.env.STR_TSL_IND || "PSR";
    static STR_VOL_RNG = (process.env.STR_VOL_RNG || "0 0").split(" ").filter(x => x.length > 0).map(x => parseFloat(x)).filter(x => (!Number.isNaN(x)));

    static DE_LOCAL_URL = process.env.DE_LOCAL_URL ?? "";
    static DE_LOCAL_PUB_KEY = keypair.publicKey.toBase58();
    static DE_LOCAL_KEYPAIR = keypair;

    static TG_TOKEN = process.env.TG_TOKEN ?? "";
    static TG_CHAT_ID = parseInt(process.env.TG_CHAT_ID ?? "0");
    static TG_POLLING = process.env.TG_POLLING == "true";
    static TG_SEND_START = process.env.TG_SEND_START == "true";
    static TG_SEND_STOP = process.env.TG_SEND_STOP == "true";
    static TG_SEND_AUDIT_FAILED = process.env.TG_SEND_AUDIT_FAILED == "true";
    static TG_SEND_WHALE = process.env.TG_SEND_WHALE == "true";
    static TG_WH_SECRET_TOKEN = process.env.TG_WH_SECRET_TOKEN ?? "";
    static TG_MESSAGE_DURATION_MS = parseInt(process.env.TG_MESSAGE_DURATION_MS || "5000") || 5000;
    static TG_BOT_URL = process.env.TG_BOT_URL ?? "";

    static EX_QUICKNODE = process.env.EX_QUICKNODE ?? "";
    static EX_RPC = process.env.EX_RPC ?? "";
    static IND_ML_DATA_PATH = Site.IND_ML_COLLECT_DATA ? (path.join(rootDir(), `ml_${Site.IND_CFG.MLDP || "default"}.json`)) : "";


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
    static TRADE_MAX_RETRIES_ENTRY = parseInt(process.env.TRADE_MAX_RETRIES_ENTRY || process.env.TRADE_MAX_RETRIES || "0") || 0;
    static TRADE_MAX_RETRIES_EXIT = parseInt(process.env.TRADE_MAX_RETRIES_EXIT || process.env.TRADE_MAX_RETRIES || "0") || 0;
    static TRADE_RETRY_TIMEOUT_MS = parseInt(process.env.TRADE_RETRY_TIMEOUT_MS || "0") || 10000;
    static TRADE_AUTO_RECOVERY = (process.env.TRADE_AUTO_RECOVERY || "").toLowerCase() == "true";
    static TRADE_SEND_RETRY_NOTIFICATION = (process.env.TRADE_SEND_RETRY_NOTIFICATION || "").toLowerCase() == "true";
    static AUTO_ACCEPT_TOKEN = (process.env.AUTO_ACCEPT_TOKEN || "").toLowerCase() == "true";

    static ZERO_THRESHOLD = parseFloat(process.env.ZERO_THRESHOLD || "0") || 0.1;

    static WH_MAX_WHALES = parseInt(process.env.WH_MAX_WHALES || "0") || 10;
    static WH_MAX_LOGS = parseInt(process.env.WH_MAX_LOGS || "0") || 30;
    static TOKEN_MAX_BUYS = parseInt(process.env.TOKEN_MAX_BUYS || "0") || 100;
    static TURN_OFF_KIKO = (process.env.TURN_OFF_KIKO || "").toLowerCase() == "true";

    static CSBUY_USE = (process.env.CSBUY_USE || "").toLowerCase() == "true";
    static CSBUY_AMT_BASE = parseFloat(process.env.CSBUY_AMT_BASE || "0") || 0;
    static CSBUY_PSAR_SL = Math.abs(parseInt(process.env.CSBUY_PSAR_SL || "0") || 0);
    static CSBUY_SELL = (process.env.CSBUY_SELL || "").split("|").filter(x => x.length > 0).map(x => x.split(" ").filter(y => y.length > 0).map(y => parseFloat(y)).filter(y => !Number.isNaN(y))).filter(x => x.length >= 2 && x.length <= 5).map(x => ({ pnl: x[0], perc: x[1], trailing: (x[2] || 0) > 0, minPnL: x[3] ?? Number.MIN_VALUE, maxPnL: x[4] || Number.MAX_VALUE })).filter(x => x.pnl != 0 && x.perc >= 1 && x.perc <= 100);
    static CSBUY_ALLOWED_SL_PERC_RANGE = (process.env.CSBUY_ALLOWED_SL_PERC_RANGE || "").split(" ").filter(x => x.length > 0).map(x => parseFloat(x)).filter(x => (!Number.isNaN(x)));
    static CSBUY_REINVEST_PROFIT = (process.env.CSBUY_REINVEST_PROFIT || "").toLowerCase() == "true";
    static CSBUY_MAX_CAPITAL = parseFloat(process.env.CSBUY_MAX_CAPITAL || "0") || Infinity;
    static COLLECTOR_MAX_FILE_SIZE_BYTES = parseInt(process.env.COLLECTOR_MAX_FILE_SIZE_BYTES || "0") || Infinity;
    static COLLECTOR_CHECKER_COOLDOWN_MS = parseInt(process.env.COLLECTOR_CHECKER_COOLDOWN_MS || "0") || 20000;

    static SIM_TOKENS = (process.env.SIM_TOKENS || "").split(" ").filter(x => Regex.mint.test(x));
    static SIM_TOTAL_ROWS = parseInt(process.env.SIM_TOTAL_ROWS || "0") || 1000;
    static SIM_ANALYSIS_ROWS = parseInt(process.env.SIM_ANALYSIS_ROWS || "0") || 100;
    static SIM_ANALYSIS_ROWS_MAX = parseInt(process.env.SIM_ANALYSIS_ROWS_MAX || "0") || 1000;
    static SIM_INTERVAL_MS = parseInt(process.env.SIM_INTERVAL_MS || "0") || 60000;
    static SIM_EXECS = (process.env.SIM_EXECS || "").split(" ").filter(x => x.length > 0);
    static SIM_EXEC_USE_HIGH_FOR_RATE = (process.env.SIM_EXEC_USE_HIGH_FOR_RATE || "").toLowerCase() == "true";
    static SIM_REPORT_INCLUDE_TRADES = (process.env.SIM_REPORT_INCLUDE_TRADES || "").toLowerCase() == "true";

    static UI_AUTH = (process.env.UI_AUTH || "").toLowerCase() == "true";
    static UI_AUTH_BYPASSED_PATHS = (process.env.UI_AUTH_BYPASSED_PATHS || "").split(" ").filter(pth => pth.length > 0);
    static UI_AUTH_JWT_ISSUER = process.env.UI_AUTH_JWT_ISSUER || Site.TITLE;
    static UI_AUTH_SESS_EXP_MS = parseInt(process.env.UI_AUTH_SESS_EXP_MS || "0") || 7200000;
    static UI_AUTH_COOK_EXP_MS = parseInt(process.env.UI_AUTH_COOK_EXP_MS || "0") || 86400000;
    static UI_AUTH_JWT_RENEW_TIMELEFT_MS = parseInt(process.env.UI_AUTH_JWT_RENEW_TIMELEFT_MS || "0") || 720000;
    static UI_AUTH_USERNAME = process.env.UI_AUTH_USERNAME || "admin";
    static UI_AUTH_PASSWORD = process.env.UI_AUTH_PASSWORD || "root";
    static UI_AUTH_JWT_USER_SECRET = process.env.UI_AUTH_JWT_USER_SECRET || "wreiynififw";
    static UI_AUTH_JWT_SECRET_PREFIX = process.env.UI_AUTH_JWT_SECRET_PREFIX || "en8fyb7bfwf";
    static UI_AUTH_COOK_SECRET = process.env.UI_AUTH_COOK_SECRET || "34rif38nyfwf";
    static UI_AUTH_JWT_COOKIE_NAME = process.env.UI_AUTH_JWT_COOKIE_NAME || "sess";
    static UI_AUTH_IPBLACKLIST_MAX_DURATION_MS = parseInt(process.env.UI_AUTH_IPBLACKLIST_MAX_DURATION_MS || "0") || 3600000;
    static UI_AUTH_MAX_FAILED_LOGIN_ATTEMPTS = parseInt(process.env.UI_AUTH_MAX_FAILED_LOGIN_ATTEMPTS || "0") || 5;
    static UI_DEV_URL = process.env.UI_DEV_URL || "/";
    static UI_CHART_MULTIPLES = (process.env.UI_CHART_MULTIPLES || "1 2 5").split(" ").map(x => parseInt(x)).filter(x => Number.isInteger(x) && x > 0);
    static UI_CHART_HEIGHT_PX = parseInt(process.env.UI_CHART_HEIGHT_PX || "0") || 0;

    static PS_USE = (process.env.PS_USE || "").toLowerCase() == "true";
    static PS_DEFAULT_DETAILS = Object.fromEntries((process.env.PS_DEFAULT_DETAILS || "").split(" ").filter(x => x.length > 0).map(x => x.split("=")).filter(x => x.length == 2).map(x => ([x[0], x[1]])));
    static PS_RECONNECT_TIMEOUT_MS = parseInt(process.env.PS_RECONNECT_TIMEOUT_MS || "0") || 0;
    static PS_MAX_RECON_RETRIES = parseInt(process.env.PS_MAX_RECON_RETRIES || "0") || 5;
    static PS_PF_TOTAL_SUPPLY = parseFloat(process.env.PS_PF_TOTAL_SUPPLY || "0") || 1_000_000_000_000_000;
}

module.exports = Site;