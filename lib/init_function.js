const Log = require("./log");
const SolPrice = require("../engine/sol_price");
const TelegramEngine = require("../engine/telegram");
const TokenEngine = require("./../engine/token");
const Site = require("../env");
const PumpswapEngine = require("../engine/pumpswap");

/**
 * Handles initialization of various drivers and modules before process fully is started.
 * @param {Function} callback - a boolean parameter callback function.
 */
const main = async (callback) => {
    const init = (await SolPrice.init()) &&
        ((!Site.TG) ? true : (await TelegramEngine.init())) &&
        (await TokenEngine.init()) &&
        (await PumpswapEngine.start());
    if (init) {
        Log.flow(`Init > Successful.`, 0);
        setTimeout(async () => {
            for (const mint of Site.COLLECTOR_AUTO_TOKENS) {
                if (TokenEngine.getTokensMint().indexOf(mint) >= 0) {
                    TelegramEngine.sendMessage(`❌ Token already being monitored`);
                }
                else {
                    const r = await TokenEngine.registerToken(mint, "Telegram");
                    if (r) {
                        const token = TokenEngine.getToken(mint);
                        TelegramEngine.sendMessage(`✅ ${token.name} \\(${token.symbol}\\) is now being monitored${token.description ? `\n\n\`\`\`\n${token.description}\`\`\`` : ''}`);
                        token.description = "";
                    }
                    else {
                        TelegramEngine.sendMessage(`❌ An error was encountered while adding token`);
                    }
                }
            }
        }, 5000);
    }
    else {
        Log.flow(`Init > Failed.`, 0);
    }
    callback(init);
}

module.exports = main;