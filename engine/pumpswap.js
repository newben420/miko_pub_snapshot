const Site = require("../env");
const { connect, NatsConnection, StringCodec, Subscription } = require("nats.ws");
const Log = require("../lib/log");
const parseHexFloat = require("../lib/parse_hex_float");
const { get } = require("axios");

let TokenEngine = null;
let ObserverEngine = null;
let WhaleEngine = null;
const MAX_RETRIES = Site.PS_MAX_RECON_RETRIES;
let RETRIES = 0;

class PumpswapEngine {

    /**
     * @type {string}
     */
    static #username = Site.PS_DEFAULT_DETAILS.username;

    /**
     * @type {string}
     */
    static #password = Site.PS_DEFAULT_DETAILS.password;

    /**
     * @type {string}
     */
    static #server = Site.PS_DEFAULT_DETAILS.server;

    /**
     * @type {null|NatsConnection}
     */
    static #nc = null;

    /**
     * @type {Map<string, {callback: (data: any) => void; sub: Subscription}>};
     */
    static #subscriptions = new Map();

    /**
     * @type {Map<string, {pool: string; baseDec: number, quoteDec: number; lpSupply: number; totalSupply: number; liquidUSD: number}>}
     */
    static #metadata = new Map();

    /**
     * @type {string[]};
     */
    static #mintPoolPairs = [];

    static #decode = StringCodec();

    /**
     * @returns {Promise<boolean>}
     */
    static #connect = () => new Promise(async (resolve, reject) => {
        try {
            Log.flow(`PSE > Connect > initializing.`, 3);
            PumpswapEngine.#nc = await connect({
                servers: PumpswapEngine.#server,
                user: PumpswapEngine.#username,
                pass: PumpswapEngine.#password,
            });
            Log.flow(`PSE > Connect > Connected to server.`, 3);
            RETRIES = 0;

            PumpswapEngine.#nc.closed().then((err) => {
                if (err) {
                    Log.dev(err);
                    Log.flow(`PSE > Connect > Connection closed with error${err.message ? `: ${err.message}` : ``}.`, 3);
                    if (Site.PS_RECONNECT_TIMEOUT_MS && RETRIES <= MAX_RETRIES) {
                        setTimeout(async () => {
                            if (await PumpswapEngine.#updateCredentials(true)) {
                                await PumpswapEngine.#disconnect();
                                if (await PumpswapEngine.#connect()) {
                                    for (const [topic, { callback }] of PumpswapEngine.#subscriptions) {
                                        const existing = PumpswapEngine.#subscriptions.get(topic);
                                        if (existing?.sub) {
                                            existing.sub.unsubscribe();
                                        }
                                        const s = PumpswapEngine.#sub(topic, callback, true);
                                        if (s) {
                                            PumpswapEngine.#subscriptions.set(topic, { sub: s, callback });
                                        }
                                    }
                                }
                                else {
                                    RETRIES = RETRIES + 1;
                                }
                            }
                        }, Site.PS_RECONNECT_TIMEOUT_MS);
                    }
                }
                else {
                    Log.flow(`PSE > Connect > Connection closed normally.`, 3);
                }
            });
            resolve(true);
        } catch (error) {
            Log.flow(`PSE > Connect > An error was encountered.`, 3);
            Log.dev(error);
            resolve(false);
        }
    });

    /**
     * @returns {Promise<boolean>}
     */
    static #disconnect = () => new Promise(async (resolve, reject) => {
        if (PumpswapEngine.#nc) {
            await PumpswapEngine.#nc.close();
            Log.flow(`PSE > Disconnect > Disconnected from server.`, 3);
        }
        else {
            resolve(true);
        }
    });

    static #parseMessage = (d) => {
        const floatFields = [
            "timestamp", "baseAmountOut", "baseAmountIn", "maxQuoteAmountIn",
            "minQuoteAmountOut", "userBaseTokenReserves", "userQuoteTokenReserves",
            "poolBaseTokenReserves", "poolQuoteTokenReserves", "quoteAmountIn",
            "quoteAmountOut", "lpFeeBasisPoints", "lpFee", "protocolFeeBasisPoints",
            "protocolFee", "quoteAmountInWithLpFee", "quoteAmountOutWithoutLpFee",
            "userQuoteAmountIn", "userQuoteAmountOut", "coinCreatorFeeBasisPoints", "coinCreatorFee"
        ];

        const o = {};
        for (const key of floatFields) {
            if (d[key] !== undefined) {
                o[key] = parseHexFloat(d[key]) || 0;
                delete d[key];
            }
        }
        return { ...d, ...o };
    };


    /**
     * @param {string} topic 
     * @param {(data: any) => void} callback 
     * @param {boolean} force 
     */
    static #sub = (topic, callback, force = false) => {
        if (PumpswapEngine.#nc) {
            if (PumpswapEngine.#subscriptions.has(topic) && (!force)) {
                Log.flow(`PSE > Subscribe > Already subscribed: ${topic}`, 3);
            }
            else {
                const s = PumpswapEngine.#nc.subscribe(topic);
                PumpswapEngine.#subscriptions.set(topic, { sub: s, callback });

                (async () => {
                    for await (const msg of s) {
                        const decoded = PumpswapEngine.#decode.decode(msg.data);
                        try {
                            // console.log("d", decoded);
                            const json = JSON.parse(JSON.parse(decoded));
                            if (json.name && json.data && ["buyevent", "sellevent"].includes(json.name.toLowerCase())) {
                                const data = PumpswapEngine.#parseMessage(json.data);
                                json.data = data;
                                if (json.index) {
                                    json.index = parseHexFloat(json.index) || 0;
                                }
                                if (json.slot) {
                                    json.slot = parseHexFloat(json.slot) || 0;
                                }
                                if (json.data.timestamp) {
                                    json.data.timestamp = json.data.timestamp * 1000;
                                }
                                if (json.receivedAt && json.data.timestamp) {
                                    json.latency = Math.abs(json.receivedAt - json.data.timestamp);
                                }
                                const meta = PumpswapEngine.#metadata.get(json.data.pool);
                                if (meta) {
                                    const baseDec = 10 ** meta.baseDec;
                                    const quoteDec = 10 ** meta.quoteDec;
                                    const baseRes = Number(json.data.poolBaseTokenReserves) / baseDec;
                                    const quoteRes = Number(json.data.poolQuoteTokenReserves) / quoteDec;

                                    json.data.priceSol = quoteRes / baseRes; // token price in SOL
                                    json.data.marketcapSol = json.data.priceSol * meta.totalSupply / 10 ** meta.baseDec;

                                    /**
                                     * @type {boolean}
                                     */
                                    const isBuy = (json.name || '').toLowerCase().includes('buy');
                                    const ppOBJ = {};
                                    // solAmount - amount of sol in the trx
                                    ppOBJ.solAmount = (isBuy ? json.data.quoteAmountIn : json.data.quoteAmountOut) / quoteDec;
                                    // tokenAmount - amount of token in the trx
                                    ppOBJ.tokenAmount = (isBuy ? json.data.baseAmountOut : json.data.baseAmountIn) / baseDec;
                                    // traderPublicKey - trader address
                                    ppOBJ.traderPublicKey = json.data.user;
                                    // mint - mint adress of the token
                                    const mint = (PumpswapEngine.#mintPoolPairs.find(x => x.endsWith(`#${json.data.pool}#`)) || '').split("#").filter(x => x.length > 0)[0];
                                    if (mint) {
                                        ppOBJ.mint = mint;
                                    }
                                    // txType - "buy" | "sell"
                                    ppOBJ.txType = isBuy ? 'buy' : 'sell';
                                    // signature - signature of the transaction
                                    ppOBJ.signature = json.tx;
                                    // pool = pump-amm
                                    ppOBJ.pool = "pump-amm";
                                    // newTokenBalance = amount the trader has after trx
                                    ppOBJ.newTokenBalance = isBuy ? json.data.userBaseTokenReserves : json.data.userQuoteTokenReserves;
                                    // marketcap
                                    ppOBJ.marketCapSol = json.data.marketcapSol;
                                    // ppOBJ.priceSol = json.data.priceSol;
                                    // debug
                                    ppOBJ.latencyMS = json.latency;
                                    if (!TokenEngine) {
                                        TokenEngine = require("./token");
                                    }
                                    if (!ObserverEngine) {
                                        ObserverEngine = require("../kiko/observer");
                                    }
                                    if (!WhaleEngine) {
                                        WhaleEngine = require("./whale").WhaleEngine;
                                    }
                                    TokenEngine.newTrade(ppOBJ);
                                    // ObserverEngine.newTrade(message);
                                    WhaleEngine.newTrade(ppOBJ);
                                    callback(ppOBJ);
                                }
                            }
                            else {
                                Log.dev("Unknown event message");
                                Log.dev(json);
                            }
                        } catch (error) {
                            Log.dev(error);
                        }
                    }
                })();
                Log.flow(`PSE > Subscribe > ${topic}.`, 3);
                return s;
            }
        }
        return null;
    };

    /**
     * @param {string} topic 
     */
    static #unsub = (topic) => {
        const s = PumpswapEngine.#subscriptions.get(topic);
        if (s) {
            s.sub.unsubscribe();
            PumpswapEngine.#subscriptions.delete(topic);
            Log.flow(`PSE > Unsubscribe > ${topic}.`, 3);
        }
    }

    /**
     * @returns {Promise<boolean>}
     */
    static #updateCredentials = (force = false) => new Promise(async (resolve, reject) => {
        const BASE = "https://swap.pump.fun";
        try {
            Log.flow(`PSE > Update Credentials > initialized.`, 3);
            if (PumpswapEngine.#server && PumpswapEngine.#username && PumpswapEngine.#password && (!force)) {
                Log.flow(`PSE > Update Credentials > Using predefined credentials.`, 3);
                resolve(true);
            }
            else {
                Log.flow(`PSE > Update Credentials > Fetching remote credentials.`, 3);
                const html = await (await fetch(BASE)).text();
                const chunkRegex = /\/_next\/static\/chunks\/[a-zA-Z0-9-]+\.js[^"']*/g;
                const chunks = [...html.matchAll(chunkRegex)].map(m => m[0]);
                let r = [false, '', '', ''];

                for (const path of chunks) {
                    const url = `${BASE}${path}`;
                    const js = await (await fetch(url)).text();

                    // 3. look for NATS creds
                    const match = js.match(
                        /servers:\s*"(wss:\/\/[^"]+)",\s*user:\s*"([^"]+)",\s*pass:\s*"([^"]+)"/
                    );

                    if (match) {
                        const [, servers, user, pass] = match;
                        r[0] = true;
                        r[1] = servers;
                        r[2] = user;
                        r[3] = pass;
                        break;
                    }
                }
                if (r[0]) {
                    Log.flow(`PSE > Update Credentials > Found and updated credentials.`, 3);
                    PumpswapEngine.#server = r[1];
                    PumpswapEngine.#username = r[2];
                    PumpswapEngine.#password = r[3];
                    resolve(true);
                }
                else {
                    Log.flow(`PSE > Update Credentials > Could not find credentials.`, 3);
                    resolve(false);
                }
            }

        } catch (error) {
            Log.flow(`PSE > Update Credentials > An error was encountered.`, 3);
            Log.dev(error);
            resolve(false);
        }
    });

    /**
     * @param {string} mint 
     * @returns {Promise<null|{pool: string; baseDec: number, quoteDec: number; lpSupply: number; totalSupply: number; liquidUSD: number}>}
     */
    static #resolveMetadata = (mint) => new Promise(async (resolve, reject) => {
        try {
            // const r = (await get(`https://swap-api.pump.fun/v1/pools/pair?mintA=So11111111111111111111111111111111111111112&mintB=${mint}&sort=liquidity`)).data;
            const [r, s] = (await Promise.all([
                get(`https://swap-api.pump.fun/v1/pools/pair?mintA=So11111111111111111111111111111111111111112&mintB=${mint}&sort=liquidity`),
                get(`https://frontend-api-v3.pump.fun/coins/${mint}`),
            ])).map(x => x.data);
            if (Array.isArray(r) && r.length > 0 && r[0].address && r[0].lpSupply && r[0].liquidityUSD && s && s.total_supply) {
                const obj = {};
                obj.pool = r[0].address;
                obj.baseDec = parseInt(r[0].baseMintDecimals) || 0;
                obj.quoteDec = parseInt(r[0].quoteMintDecimals) || 0;
                obj.lpSupply = parseFloat(r[0].lpSupply) || 0;
                obj.totalSupply = parseFloat(s.total_supply) || Site.PS_PF_TOTAL_SUPPLY;
                obj.liquidUSD = parseFloat(r[0].liquidityUSD) || 0;
                resolve(obj);
            }
            else {
                resolve(null);
            }
        } catch (error) {
            Log.dev(error);
            resolve(null);
        }
    });

    /**
     * @param {string} mint 
     * @param {(data: any) => void} callback 
     * @returns {Promise<boolean>}
     */
    static monitor = (mint, callback = (data) => {}) => new Promise(async (resolve, reject) => {
        Log.flow(`PSE > Monitor > ${mint} > Initialized.`, 3);
        const meta = await PumpswapEngine.#resolveMetadata(mint);
        if (meta) {
            const {
                pool,
            } = meta;
            Log.flow(`PSE > Monitor > ${mint} > Pool obtained: ${pool}.`, 3);
            const pairKey = `${mint}#${pool}#`;
            if (PumpswapEngine.#mintPoolPairs.includes(pairKey)) {
                resolve(false);
            }
            else {
                const subbed = PumpswapEngine.#sub(`ammTradeEvent.${pool}`, callback);
                if (subbed) {
                    PumpswapEngine.#mintPoolPairs.push(pairKey);
                    PumpswapEngine.#metadata.set(pool, meta);
                    resolve(true);
                }
                else {
                    resolve(false);
                }
            }
        }
        else {
            Log.flow(`PSE > Monitor > ${mint} > Could not get metadata.`, 3);
            resolve(false);
        }
    });

    /**
     * @param {string} mint 
     * @returns {Promise<boolean>}
     */
    static unmonitor = (mint) => new Promise((resolve, reject) => {
        Log.flow(`PSE > Unmonitor > ${mint} > Initialized.`, 3);
        const pairKey = PumpswapEngine.#mintPoolPairs.find(x => x.startsWith(`${mint}#`));
        if (pairKey) {
            const pool = pairKey.split("#").filter(x => x.length > 0)[1];
            if (pool) {
                PumpswapEngine.#unsub(`ammTradeEvent.${pool}`);
                PumpswapEngine.#metadata.delete(pool);
                PumpswapEngine.#mintPoolPairs = PumpswapEngine.#mintPoolPairs.filter(x => !x.startsWith(`${mint}#`));
                resolve(true);
            }
            else {
                Log.flow(`PSE > Unmonitor > ${mint} > Data not found.`, 3);
                resolve(false);
            }
        }
        else {
            resolve(false);
        }
    });


    /**
     * @returns {Promise<boolean>}
     */
    static start = () => new Promise(async (resolve, reject) => {
        if (Site.PS_USE) {
            if (await PumpswapEngine.#updateCredentials()) {
                const c = await PumpswapEngine.#connect();
                if (c) {
                    resolve(true);
                }
                else {
                    resolve(false);
                }
            }
            else {
                resolve(false);
            }
        }
        else {
            resolve(true);
        }
    });

    /**
     * @returns {Promise<boolean>}
     */
    static stop = () => new Promise(async (resolve, reject) => {
        if (Site.PS_USE) {
            await PumpswapEngine.#disconnect();
            resolve(true);
        }
        else {
            resolve(true);
        }
    });
}

module.exports = PumpswapEngine;