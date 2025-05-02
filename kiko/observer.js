const SolPrice = require("../engine/sol_price");
const Site = require("../env");
const FFF = require("../lib/fff");
const getTimeElapsed = require("../lib/get_time_elapsed");
const Log = require("../lib/log");
const AuditEngine = require("./audit");
const GraduateEngine = require("./graduate");
const { ObserverToken } = require("./kiko_model");

/**
 * This monitors tokens until they graduate or fail
 */
class ObserverEngine {

    /**
   * Websocket reference.
   * @type {WebSocket|null}
   */
    static #ws = null;

    /**
     * Registers websocket.
     * @param {WebSocket} ws 
     */
    static registerSocket = (ws) => {
        ObserverEngine.#ws = ws;
    }

    /**
   * Starts observing a token.
   * @param {string} mint - Token mint address.
   */
    static #startObservation = (mint) => {
        let payload = {
            method: "subscribeTokenTrade",
            keys: [mint]
        }
        ObserverEngine.#ws.send(JSON.stringify(payload));
    }

    /**
    * Stops observing a token.
    * @param {string} mint - Token mint address.
    */
    static #stopObservation = (mint) => {
        let payload = {
            method: "unsubscribeTokenTrade",
            keys: [mint]
        }
        ObserverEngine.#ws.send(JSON.stringify(payload));
    }

    /**
     * Total number of tokens that have been observed
     * @type {number}
     */
    static observed = 0;

    /**
     * Tokens being observed
     * @type {Record<string,ObserverToken>}
     */
    static tokens = {};

    /**
     * Tokens that have passed through the launch phase are sent here to be observed.
     * @param {any} message 
     */
    static newToken = (message) => {
        if (Object.keys(ObserverEngine.tokens).length < Site.OB_MAX_TOKENS && message.mint && !ObserverEngine.tokens[message.mint]) {
            /**
             * @type {string}
             */
            const mint = message.mint;
            ObserverEngine.tokens[mint] = new ObserverToken(message, ObserverEngine.removeToken, AuditEngine.run);
            Log.flow(`Observer > ${ObserverEngine.tokens[mint].name || ""} (${ObserverEngine.tokens[mint].symbol || ""}) > Added (${Object.keys(ObserverEngine.tokens).length} / ${Site.OB_MAX_TOKENS}).`, 4);
            ObserverEngine.#startObservation(mint);
            ObserverEngine.observed++;
        }
    }

    /**
     * Removes token from being observed.
     * @param {string} mint 
     * @returns {Promise<boolean>}
     */
    static removeToken = (mint) => {
        return new Promise(async (resolve, reject) => {
            if (ObserverEngine.tokens[mint]) {
                const destroyed = await ObserverEngine.tokens[mint].internalDestroy();
                if (destroyed) {
                    ObserverEngine.#stopObservation(mint);
                    Log.flow(`Observer > ${ObserverEngine.tokens[mint].name || ""} (${ObserverEngine.tokens[mint].symbol || ""}) > Removed (Reg: ${getTimeElapsed(ObserverEngine.tokens[mint].reg_timestamp, Date.now())} | LU: ${getTimeElapsed(ObserverEngine.tokens[mint].last_updated, Date.now())} | Reason: ${ObserverEngine.tokens[mint].remove_remark} | MC: ${Site.BASE} ${FFF(ObserverEngine.tokens[mint].marketcapSol)} USD ${FFF(ObserverEngine.tokens[mint].marketcapSol * SolPrice.get())} | Vol: ${Site.BASE} ${FFF((ObserverEngine.tokens[mint].buy_volume_sol + ObserverEngine.tokens[mint].sell_volume_sol))} USD ${FFF((ObserverEngine.tokens[mint].buy_volume_sol + ObserverEngine.tokens[mint].sell_volume_sol) * SolPrice.get())}).`, 4);
                    delete ObserverEngine.tokens[mint];
                    resolve(true);
                }
                else {
                    resolve(false);
                }
            }
            else {
                resolve(false);
            }
        })
    }

    /**
     * Is invoked whenever there is a new trade for an observed token
     * @param {any} message 
     */
    static newTrade = async (message) => {
        if (message.mint) {
            const mint = message.mint;
            if (ObserverEngine.tokens[mint]) {
                if (message.pool ? (message.pool == Site.LA_POOL || Site.LA_POOL == "auto") : false) {
                    ObserverEngine.tokens[mint].last_updated = Date.now()
                    const { traderPublicKey, txType, tokenAmount, solAmount, newTokenBalance, marketCapSol, vSolInBondingCurve } = message;
                    // Update Holders
                    if (traderPublicKey) {
                        if (ObserverEngine.tokens[mint].holders[traderPublicKey] || ObserverEngine.tokens[mint].holders[traderPublicKey] === 0) {
                            if (txType == "buy") {
                                if (newTokenBalance) {
                                    ObserverEngine.tokens[mint].holders[traderPublicKey] = parseFloat(newTokenBalance) || 0;
                                }
                                else {
                                    ObserverEngine.tokens[mint].holders[traderPublicKey] += parseFloat(tokenAmount) || 0;
                                }
                            }
                            else {
                                if (newTokenBalance) {
                                    ObserverEngine.tokens[mint].holders[traderPublicKey] = parseFloat(newTokenBalance) || 0;
                                }
                                else {
                                    delete ObserverEngine.tokens[mint].holders[traderPublicKey];
                                }
                            }
                        }
                        else {
                            if (txType == "buy") {
                                if (newTokenBalance) {
                                    ObserverEngine.tokens[mint].holders[traderPublicKey] = parseFloat(newTokenBalance) || 0;
                                }
                                else {
                                    ObserverEngine.tokens[mint].holders[traderPublicKey] += parseFloat(tokenAmount) || 0;
                                }
                            }
                            else {
                                if (newTokenBalance) {
                                    ObserverEngine.tokens[mint].holders[traderPublicKey] = parseFloat(newTokenBalance) || 0;
                                }
                                else {
                                    delete ObserverEngine.tokens[mint].holders[traderPublicKey];
                                }
                            }
                        }
                    }
                    // Update Volume and Trades
                    if (solAmount) {
                        if (txType == "buy") {
                            ObserverEngine.tokens[mint].buys++;
                            ObserverEngine.tokens[mint].buy_volume_sol += parseFloat(solAmount) || 0;
                        }
                        else {
                            ObserverEngine.tokens[mint].sells++;
                            ObserverEngine.tokens[mint].sell_volume_sol += parseFloat(solAmount) || 0;
                        }
                    }
                    // Update Marketcap
                    ObserverEngine.tokens[mint].marketcapSol = parseFloat(marketCapSol) || 0;
                    // Update Price and Circulating Supply
                    if (solAmount && tokenAmount && marketCapSol) {
                        let sa = parseFloat(solAmount) || 0;
                        let ta = parseFloat(tokenAmount || 0);
                        let mc = parseFloat(marketCapSol || 0);
                        ObserverEngine.tokens[mint].price = (sa / ta) || 0;
                        ObserverEngine.tokens[mint].circulating_supply = (mc / ObserverEngine.tokens[mint].price) || 0;
                    }
                    // Update Bonding Progress
                    ObserverEngine.tokens[mint].bonding_progress = ((parseFloat(vSolInBondingCurve || "0") || 0) / 115) * 100;


                    // console.log(`${ ObserverEngine.tokens[mint].name} Bonding => ${ObserverEngine.tokens[mint].bonding_progress}`, `| Audit @ ${Site.OB_AUDIT_BD_PROGRESS}`, `| Graduate @ ${Site.OB_GRADUATE_BD_PROGRESS}`);

                    if (ObserverEngine.tokens[mint].bonding_progress >= Site.OB_AUDIT_BD_PROGRESS && (ObserverEngine.tokens[mint].audited ? ((Date.now() - ObserverEngine.tokens[mint].audit_timestamp) >= Site.OB_AUDIT_VALIDITY_DURATION) : true)) {
                        ObserverEngine.tokens[mint].triggerAudit();
                    }

                    if (ObserverEngine.tokens[mint].bonding_progress >= Site.OB_GRADUATE_BD_PROGRESS && ObserverEngine.tokens[mint].audited) {
                        const graduateData = ObserverEngine.tokens[mint].getGraduateData();
                        ObserverEngine.tokens[mint].remove_remark = "Graduated";
                        if (await ObserverEngine.removeToken(mint)) {
                            GraduateEngine.entry(graduateData);
                        }
                    }
                }
                else if (message.pool && message.pool != "pump") {
                    if (ObserverEngine.tokens[mint].audited ? false : true) {
                        ObserverEngine.tokens[mint].triggerAudit();
                    }
                    else {
                        const graduateData = ObserverEngine.tokens[mint].getGraduateData();
                        ObserverEngine.tokens[mint].remove_remark = "Graduated";
                        if (await ObserverEngine.removeToken(mint)) {
                            GraduateEngine.entry(graduateData);
                        }
                    }
                }

            }
        }
    }

}

module.exports = ObserverEngine;