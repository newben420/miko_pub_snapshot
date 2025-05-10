const Site = require("../env");
const FFF = require("../lib/fff");
const floorToSigFigs = require("../lib/floor_sig_figs");
const Log = require("../lib/log");
const SolPrice = require("./sol_price");
const TokenEngine = require("./token");
let TelegramEngine = null;

/**
 * This class is for handling automated buying of telegram added tokens using candlestick analysis.
 * Suitable for scalping on established tokens.
 */
class CSBuy {

    static activated = Site.CSBUY_USE;

    /**
     * Signals come through here
     * @param {string} name 
     * @param {string} mint 
     * @param {string} description 
     * @param {number} markPrice 
     * @param {number} slPrice 
     */
    static entry = async (name, mint, description, markPrice, slPrice,) => {
        const token = TokenEngine.getToken(mint);
        if (token && CSBuy.activated) {
            if (token.source == "Telegram" && token.amount_held <= 0) {
                Log.flow(`CSB > ${name} > Initiated.`, 3);
                const takenSpots = TokenEngine.getAllTokens().filter(token => token.amount_held > 0 && token.mint != mint).length;
                if (takenSpots >= Site.TOKEN_MAX_BUYS) {
                    Log.flow(`CSB > ${name} > No available spot.`, 3);
                }
                else {
                    const profit = Math.max(0, (Site.SIMULATION ? TokenEngine.realizedPnLSimulation : TokenEngine.realizedPnLLive).map(x => x.pnl).reduce((a, b) => a + b, 0));
                    const reinvestCapital = floorToSigFigs((profit / Site.TOKEN_MAX_BUYS) || 0) || 0;
                    const amt = Math.min(Site.CSBUY_MAX_CAPITAL, (Site.CSBUY_AMT_BASE + (Site.CSBUY_REINVEST_PROFIT ? reinvestCapital : 0)));
                    if (amt > 0) {
                        token.CSB = true;
                        token.SLP = slPrice;
                        token.MP = markPrice;
                        const bought = await TokenEngine.buy(mint, amt, `CSB ${description}`, Site.TRADE_MAX_RETRIES_ENTRY, [0, 0]);
                        if (!TelegramEngine) {
                            TelegramEngine = require("./telegram");
                        }
                        if (bought) {

                            if (Site.SIMULATION) {
                                const token = TokenEngine.getToken(mint) || {};
                                TelegramEngine.sendMessage(`✅ *CSBUY*\n\nSwapped ${Site.BASE} ${FFF(amt)} \\(USD ${FFF(amt * SolPrice.get())}\\) to ${token.symbol} ${FFF(bought)}\n\nMC 📈 ${Site.BASE} ${FFF(token.current_marketcap)} \\(USD ${FFF(token.current_marketcap * SolPrice.get())}\\)\nPrice 💰 ${Site.BASE} ${FFF(token.current_price)}\n`);
                            }
                            else {
                                TelegramEngine.sendMessage(`✅ *CSBUY*\n\nBuy operation completed \\(${Site.BASE} ${amt}\\)\n\n🪧 \`${bought}\``);
                            }
                        }
                        else {
                            token.CSB = false;
                            token.SLP = 0;
                        }
                    }
                    else {
                        Log.flow(`CSB > ${name} > Buy amount is not tangible.`, 3);
                    }
                }
            }
        }
    }
}

module.exports = CSBuy;