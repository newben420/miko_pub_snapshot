const Site = require("../env");
const path = require("path");
const fs = require("fs");
const Log = require("../lib/log");
const { get } = require("../lib/make_request");
const getTimeElapsed = require("../lib/get_time_elapsed");

let SocketEngine = null;

/**
 * Manages SOL/USD rate.
 */
class SolPrice {
    static #current = Site.DEFAULT_SOL_USD_PRICE || 0;

    /**
     * 
     * @returns {number} - Current price of Sol.
     */
    static get = () => {
        return SolPrice.#current;
    }

    static #run = () => {
        if(Site.PRODUCTION){
            get(Site.PF_API + "/sol-price", res => {
                if (res.succ) {
                    if (res.message.solPrice !== SolPrice.#current) {
                        SolPrice.#current = res.message.solPrice;
                        Log.flow(`SolPrice > Updated to $${SolPrice.#current}. Next in ${getTimeElapsed(Date.now(), (Date.now() + Site.SOLPRICE_INTERVAL_MS))}.`, 2);
                        if(Site.UI){
                            if(!SocketEngine){
                                SocketEngine = require("./socket");
                            }
                            SocketEngine.sendSolPrice();
                        }
                    }
                }
                setTimeout(() => {
                    SolPrice.#run();
                }, Site.SOLPRICE_INTERVAL_MS);
            });
        }
        else{
            Log.flow(`SolPrice > Kept as $${SolPrice.#current} in development mode. Next in ${getTimeElapsed(Date.now(), (Date.now() + Site.SOLPRICE_INTERVAL_MS))}.`, 2);
            if(Site.UI){
                if(!SocketEngine){
                    SocketEngine = require("./socket");
                }
                SocketEngine.sendSolPrice();
            }
            setTimeout(() => {
                SolPrice.#run();
            }, Site.SOLPRICE_INTERVAL_MS);
        }
    }

    /**
     * Ensures the driver is initialized.
     * @returns {Promise<boolean>}
     */
    static init = () => {
        return new Promise(async (resolve, reject) => {
            Log.flow(`SolPrice > Init.`, 0);
            SolPrice.#run();
            resolve(true);
        });
    }
}

module.exports = SolPrice;