const GraduateEngine = require("../kiko/graduate");
const ObserverEngine = require("../kiko/observer");
const Log = require("../lib/log");
const PumpswapEngine = require("./pumpswap");
const TokenEngine = require("./token");

class MigrateEngine {
    static newMigration = async (data) => {
        const { mint } = data;
        Log.flow(`Migrate > ${mint} > Initialized.`, 3);
        if (mint) {
            if (TokenEngine.getToken(mint)) {
                PumpswapEngine.monitor(mint);
            }
            else if (ObserverEngine.getToken(mint)) {
                const ot = ObserverEngine.getToken(mint);
                if (ot.audited) {
                    const graduateData = ot.getGraduateData();
                    ObserverEngine.tokens[mint].remove_remark = "Graduated";
                    if (await ObserverEngine.removeToken(mint)) {
                        GraduateEngine.entry(graduateData);
                    }
                }
                else {
                    await ot.triggerAudit();
                    if (ot.audited) {
                        const graduateData = ot.getGraduateData();
                        ObserverEngine.tokens[mint].remove_remark = "Graduated";
                        if (await ObserverEngine.removeToken(mint)) {
                            GraduateEngine.entry(graduateData);
                        }
                    }
                }
            }
            else {
                Log.flow(`Migrate > ${mint} > Not found.`, 3);
            }
        }
    }
}

module.exports = MigrateEngine;