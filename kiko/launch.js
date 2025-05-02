const Site = require("../env");

/**
 * Ensures launched tokens that would be observed meet configured criteria.
 */
class LaunchEngine {
    /**
     * Checks if token is eligible for observation.
     * @param {any} message 
     * @returns {Promise<boolean}
     */
    static check = (message) => {
        return new Promise((resolve, reject) => {
            if(message.name && message.symbol && message.pool){
                const {name, symbol, pool} = message;
                const joined = `${name}${symbol}`.toLowerCase();
                const nameValid = Site.LA_NAME_REGEX.test(name);
                const symbolValid = Site.LA_SYMBOL_REGEX.test(symbol);
                const listValid = Site.LA_NAME_SYMBOL_WHITELIST_LENGTH > 0 ? Site.LA_NAME_SYMBOL_WHITELIST.test(joined) : !Site.LA_NAME_SYMBOL_BLACKLIST.test(joined);
                const poolValid = Site.LA_POOL == "auto" || Site.LA_POOL == pool;
                const valid = nameValid && symbolValid && listValid && poolValid && message.mint && message.traderPublicKey;
                resolve(valid);
            }
            else{
                resolve(false);
            }
        });
    }
}

module.exports = LaunchEngine;