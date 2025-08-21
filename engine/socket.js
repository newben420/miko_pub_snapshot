const Site = require("../env");
const Log = require("../lib/log");
const { Server, Socket } = require("socket.io");
const CSBuy = require("./cs_buy");
const TokenEngine = require("./token");
const GraduateEngine = require("../kiko/graduate");
const SignalManager = require("./signal_manager");
const { WhaleEngine } = require("./whale");
const ObserverEngine = require("../kiko/observer");
const FFF = require("../lib/fff");
const { computeArithmeticDirection } = require("../lib/direction");
const { computeArithmeticDirectionMod } = require("../lib/mod_direction");
const SolPrice = require("./sol_price");
const { Token } = require("./token_model");
const Regex = require("../lib/regex");
const AuthEngine = require("./auth");
const cookie = require("cookie");
const signature = require("cookie-signature");

class SocketEngine {
    /**
     * @type {Server|null}
     */
    static #io = null;

    /**
     * Maps a socket id to the token mint they are currently opening.
     * @type {Record<string, string>}
     */
    static socketTokenMap = {}

    /**
     * This is called to pass the socketio server instance and initialize this engine.
     * @param {any} serverRef 
     */
    static init = (serverRef) => {
        SocketEngine.#io = serverRef;
        Log.flow(`SocketEngine  > Initialized.`, 0);
        SocketEngine.#io.use(async (socket, next) => {
            /**
             * @type {Record<string, string>}
             */
            let cookies = {};
            const rawCookie = socket.handshake.headers['cookie'] || "";
            const parsedCookies = cookie.parse(rawCookie);
            const signedCookies = {};
            for(const [key, val] of Object.entries(parsedCookies)){
                if((val || "").startsWith("s:")){
                    const unsigned = signature.unsign((val || '').slice(2), Site.UI_AUTH_COOK_SECRET);
                    if(unsigned){
                        cookies[key] = unsigned;
                    }

                }
            }
            if (Site.UI) {
                if(Site.UI_AUTH){
                    const username = cookies[Site.UI_AUTH_JWT_COOKIE_NAME] || cookies[Site.UI_AUTH_JWT_COOKIE_NAME + "_legacy"] || null;
                    const token = cookies[Site.UI_AUTH_JWT_COOKIE_NAME + "_jwt"] || cookies[Site.UI_AUTH_JWT_COOKIE_NAME + "_jwt_legacy"] || null;
                    if(username && token && username == Site.UI_AUTH_USERNAME){
                        const verified = await AuthEngine.verifySession(username, Site.UI_AUTH_JWT_USER_SECRET, token);
                        if(verified){
                            next();
                        }
                        else{
                            socket.disconnect(true);
                        }
                    }
                    else{
                        socket.disconnect(true);
                    }
                }
                else{
                    next();
                }
            }
            else {
                socket.disconnect();
            }
        }).on("connection", socket => {
            Log.dev(`Socket connected with ID ${socket.id}.`);
            // Initialize socket with current data.
            socket.on("init", () => {
                socket.emit("static_content", {
                    title: Site.TITLE,
                    ts: Date.now(),
                    auth: Site.UI_AUTH,
                    url: Site.URL,
                    maxCDSlength: Site.COL_MAX_LENGTH,
                    maxLogslength: Site.WH_MAX_LOGS,
                    base: Site.BASE,
                    baseDenominated: Site.BASE_DENOMINATED,
                    buys: Site.DE_BUY_AMOUNTS_SOL,
                    sells: Site.DE_SELL_PERCS_SOL,
                    histories: Site.COL_MULTIPLES_MS_ARR,
                    interval: Site.COL_DURATION_MS,
                    chartOpts: Site.UI_CHART_MULTIPLES,
                    chartHeight: Site.UI_CHART_HEIGHT_PX,
                });
                SocketEngine.sendAutomation(socket);
                SocketEngine.sendKiko(socket, null, false);
                SocketEngine.sendTokens(socket, null, false);
                SocketEngine.sendSolPrice();
            });

            // Listen for automation edit.
            socket.on('edit_auto', data => {
                const { variable, newValue } = data;
                if (variable == "AUB") {
                    TokenEngine.autoBuy = newValue;
                }
                else if (variable == "AUS") {
                    TokenEngine.autoSell = newValue;
                }
                else if (variable == "PKD") {
                    TokenEngine.autoPD = newValue;
                }
                else if (variable == "ACT") {
                    GraduateEngine.acceptToken = newValue;
                }
                else if (variable == "BAL") {
                    SignalManager.buyAlert = newValue;
                }
                else if (variable == "SAL") {
                    SignalManager.sellAlert = newValue;
                }
                else if (variable == "SIM") {
                    Site.SIMULATION = newValue;
                }
                else if (variable == "WEN") {
                    WhaleEngine.useEntry = newValue;
                }
                else if (variable == "CSB") {
                    CSBuy.activated = newValue;
                }
                else if (variable == "WEX") {
                    WhaleEngine.useExit = newValue;
                }
                SocketEngine.sendAutomation();
            });

            socket.on("add_token", async (mint, fn) => {
                if (Regex.mint.test(mint)) {
                    const registered = await TokenEngine.registerToken(mint, "Telegram");
                    if (registered) {
                        const token = TokenEngine.getToken(mint);
                        token.description = "";
                        fn(token.name);
                    }
                    else {
                        fn(null);
                    }
                }
                else {
                    fn(null);
                }
            });

            socket.on("reset_token", async (mint, fn) => {
                const token = TokenEngine.getToken(mint);
                if(token){
                    token.CSB = false;
                    token.MP = 0;
                    token.SLP = 0;
                    token.amount_held = 0;
                    token.bought_once = false;
                    token.executed_peak_drops = [];
                    token.executed_whale_exits = 0;
                    token.fees = 0;
                    token.max_pnl = 0;
                    token.min_pnl = 0;
                    token.pnl = 0;
                    token.pnl_base = 0;
                    token.total_bought_base = 0;
                    token.total_sold_base = 0;
                    fn(true);
                }
                else{
                    fn(false);
                }
            });

            socket.on("close_token", () => {
                delete SocketEngine.socketTokenMap[socket.id];
            });

            socket.on("remove_token", async (mint, fn) => {
                const done = await TokenEngine.removeToken(mint);
                fn();
            });

            socket.on('recovery', async (fn) => {
                const recovered = await TokenEngine.recovery();
                fn(recovered);
            });

            socket.on('wallet', async (fn) => {
                let obj = {};
                const balance = await TokenEngine.getBalance();
                if (balance || balance === 0) {
                    obj.succ = true;
                    obj.address = Site.DE_LOCAL_PUB_KEY;
                    obj.currency = Site.BASE;
                    obj.balance = balance;
                }
                else {
                    obj.succ = false;
                }
                fn(obj);
            });

            socket.on("open_token", (mint, fn) => {
                SocketEngine.socketTokenMap[socket.id] = mint;
                const token = TokenEngine.getToken(mint);
                fn(token ? SocketEngine.#processToken({ ...token, whaleLog: WhaleEngine.getLogs(mint), whales:  WhaleEngine.getForUI(mint)}) : null);
            });

            socket.on('stats', async (fn) => {
                let obj = {}
                obj.succ = true;
                let arr = (Site.SIMULATION ? TokenEngine.realizedPnLSimulation : TokenEngine.realizedPnLLive);
                arr = arr.concat(TokenEngine.getAllTokens().filter(x => Site.SIMULATION === x.added_in_simulation).map(x => ({ pnl: x.pnl_base, ts: x.reg_timestamp })));
                arr.sort((a, b) => a.ts - b.ts);
                arr = arr.map(x => x.pnl);
                let lPnL = arr.reduce((a, b) => a + b, 0);
                let rPnL = (Site.SIMULATION ? TokenEngine.realizedPnLSimulation : TokenEngine.realizedPnLLive).map(x => x.pnl).reduce((a, b) => a + b, 0);
                obj.livePnL = `${Site.BASE} ${FFF(lPnL)} (USD ${FFF(lPnL * SolPrice.get())})`;
                obj.realizedPnL = `${Site.BASE} ${FFF(rPnL)} (USD ${FFF(rPnL * SolPrice.get())})`;
                obj.marketCondition = `${computeArithmeticDirectionMod(arr, 5)}`;
                fn(obj);
            });

            socket.on('disconnect', () => {
                Log.dev(`Socket with ID ${socket.id} disconnected.`);
                delete SocketEngine.socketTokenMap[socket.id];
            });

            socket.on("buy", async (mint, amt, fn) => {
                if (SignalManager.activeBuy && SignalManager.latestMid) {
                    SignalManager.activeBuy = false;
                }
                const bought = await TokenEngine.buy(mint, amt, "Manual");
                if (bought) {
                    if (Site.SIMULATION) {
                        const token = TokenEngine.getToken(mint) || {};
                        fn(`✅ *BUY*\n\nSwapped ${Site.BASE} ${FFF(amt)} \\(USD ${FFF(amt * SolPrice.get())}\\) to ${token.symbol} ${FFF(bought)}\n\nMC 📈 ${Site.BASE} ${FFF(token.current_marketcap)} \\(USD ${FFF(token.current_marketcap * SolPrice.get())}\\)\nPrice 💰 ${Site.BASE} ${FFF(token.current_price)}\n`);
                    }
                    else {
                        fn(`✅ *BUY*\n\nBuy operation completed \\(${Site.BASE} ${amt}\\)\n\n🪧 \`${bought}\``);
                    }
                }
                else {
                    fn(`❌ Could not complete buy operation`);
                }
            });

            socket.on("sell", async (mint, perc, fn) => {
                if (SignalManager.acitveSell[mint] && SignalManager.acitveSellMID[mint]) {
                    delete SignalManager.acitveSell[mint];
                    delete SignalManager.acitveSellMID[mint];
                }
                const token = TokenEngine.getToken(mint) || {};
                const allocation = ((token || {}).amount_held || 0) + 0;
                const sold = await TokenEngine.sell(mint, perc, "Manual");
                if (sold) {
                    if (Site.SIMULATION) {
                        fn(`✅ *SELL*\n\nSwapped ${token.symbol} ${FFF(((perc / 100) * allocation) || 0)} \\(${perc}%\\) to ${Site.BASE} ${FFF(sold)} \\(USD ${FFF(sold * SolPrice.get())}\\)\n\nMC 📈 ${Site.BASE} ${FFF(token.current_marketcap)} \\(USD ${FFF(token.current_marketcap * SolPrice.get())}\\)\nPrice 💰 ${Site.BASE} ${FFF(token.current_price)}\n`);
                    }
                    else {
                        fn(`✅ *SELL*\n\nSell operation completed \\(${perc}%\\)\n\n🪧 \`${sold}\``);
                    }

                }
                else {
                    fn(`❌ Could not complete sell operation`);
                }
            });

            socket.on("delete_limit", async (mint, index, fn) => {
                const deleted = await TokenEngine.deleteLimitOrder(mint, index);
                if (deleted) {
                    const token = TokenEngine.getToken(mint);
                    if (token) {
                        SocketEngine.sendToken(mint, {
                            pending_orders: token.pending_orders,
                        });
                    }
                }
                fn(deleted ? `✅ Limit order deleted` : `❌ Could not delete limit order`);
            });

            socket.on("add_limit", async (mint, limit, fn) => {
                const registered = await TokenEngine.registerLimitOrder(mint, structuredClone(limit));
                if (registered) {
                    const token = TokenEngine.getToken(mint);
                    if (token) {
                        SocketEngine.sendToken(mint, {
                            pending_orders: token.pending_orders,
                        });
                    }
                    fn(`✅ Limit order registered`);
                }
                else {
                    fn(`❌ Could not register limit order`);
                }
            })
        });
    }

    /**
     * This sends automation object to all or passed socket.
     * @param {Socket|null} [socket=null] 
     */
    static sendAutomation = (socket = null) => {
        if (SocketEngine.#io) {
            let obj = {
                SIM: Site.SIMULATION,
                CSB: CSBuy.activated,
                AUB: TokenEngine.autoBuy,
                AUS: TokenEngine.autoSell,
                PKD: TokenEngine.autoPD,
                ACT: GraduateEngine.acceptToken,
                BAL: SignalManager.buyAlert,
                SAL: SignalManager.sellAlert,
                WEN: WhaleEngine.useEntry,
                WEX: WhaleEngine.useExit,
            };
            if (socket) {
                socket.emit('automation', obj);
            }
            else {
                SocketEngine.#io.emit('automation', obj);
            }
        }
    }

    /**
     * This sends Kiko observer object to all or passed socket.
     * @param {Socket|null} [socket=null] 
     * @param {any} [component=null] 
     * @param {boolean} [del=false] 
     */
    static sendKiko = (socket = null, component = null, del = false) => {
        if (SocketEngine.#io) {
            if (!component) {
                component = {
                    currentTokens: Object.keys(ObserverEngine.tokens).length,
                    allTokens: ObserverEngine.observed,
                    graduatedTokens: GraduateEngine.graduated,
                    blockedTokens: GraduateEngine.notGraduated,
                    audited: {}
                };
                Object.keys(ObserverEngine.tokens).map(x => ObserverEngine.tokens[x]).filter(x => x.audited).forEach(token => {
                    component.audited[token.mint] = {};
                    component.audited[token.mint].mint = token.mint;
                    component.audited[token.mint].name = token.name;
                    component.audited[token.mint].symbol = token.symbol;
                    component.audited[token.mint].regTimestamp = token.reg_timestamp;
                    component.audited[token.mint].auditTimestamp = token.audit_timestamp;
                    component.audited[token.mint].auditCount = token.number_of_audits;
                    component.audited[token.mint].bonding = token.bonding_progress;
                });
            }
            if (component) {
                if (socket) {
                    socket.emit('kiko', component, del);
                }
                else {
                    SocketEngine.#io.emit('kiko', component, del);
                }
            }
        }
    }

    /**
     * This sends tokens object to all or passed socket.
     * @param {Socket|null} [socket=null] 
     * @param {any} [component=null] 
     * @param {boolean} [del=false] 
     */
    static sendTokens = (socket = null, component = null, del = false) => {
        if (SocketEngine.#io) {
            if (!component) {
                component = {
                };
                TokenEngine.getAllTokens().forEach(token => {
                    component[token.mint] = {
                        name: token.name,
                        symbol: token.symbol,
                        mint: token.mint,
                        amount: token.amount_held || 0,
                        pnl: token.pnl || 0,
                    }
                });
            }
            if (component) {
                if (socket) {
                    socket.emit('tokens', component, del);
                }
                else {
                    SocketEngine.#io.emit('tokens', component, del);
                }
            }
        }
    }

    /**
     * Converts serverside token to a type compatible with client side token.
     * @param {Token} token
     * @returns {any}
     */
    static #processToken = (token) => {
        if (!token) {
            return null;
        }
        let obj = {};
        let allowedFields = [
            "name",
            "mint",
            "symbol",
            "current_price",
            "current_marketcap",
            "price_history",
            "last_updated",
            "amount_held",
            "pending_orders",
            "reg_timestamp",
            "max_marketcap",
            "min_marketcap",
            "peak_price",
            "least_price",
            "description",
            "whaleLog",
            "pnl_base",
            "pnl",
            "max_pnl",
            "min_pnl",
            "source",
            "exit_reasons",
            "entry_reasons",
            "whales",
        ]
        Object.keys(token).forEach(key => {
            if (token[key] !== undefined && allowedFields.indexOf(key) >= 0) {
                obj[key] = token[key];
            }
        });
        if (obj.entry_reasons) {
            obj.entry_reasons = Array.from(obj.entry_reasons);
        }
        if (obj.exit_reasons) {
            obj.exit_reasons = Array.from(obj.exit_reasons);
        }
        return obj;
    }

    /**
     * Sends updated data of a token to any socket currently viewing the token
     * @param {string} mint 
     * @param {Token} token 
     */
    static sendToken = (mint, token) => {
        if (SocketEngine.#io) {
            Object.keys(SocketEngine.socketTokenMap).forEach(socketid => {
                if (SocketEngine.socketTokenMap[socketid] == mint) {
                    SocketEngine.#io.to(socketid).emit("token_update", SocketEngine.#processToken(token));
                }
            });
        }
    }

    /**
     * Sends notification to all sockets.
     * @param {string} msg 
     */
    static sendNote = (msg) => {
        if (SocketEngine.#io) {
            SocketEngine.#io.emit("note", msg);
        }
    }

    static sendSolPrice = () => {
        if (SocketEngine.#io) {
            SocketEngine.#io.emit("sol_price", SolPrice.get());
        }
    }
}

module.exports = SocketEngine;