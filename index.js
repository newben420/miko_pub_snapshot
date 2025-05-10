const https = require('https');
const Site = require("./env");
if (Site.FORCE_FAMILY_4) {
    https.globalAgent.options.family = 4;
}
const express = require('express');
const app = express();
const path = require("path");
const init = require("./lib/init_function");
const killer = require("./lib/kill_process");
const Log = require("./lib/log");
const WebSocket = require('ws');
const JSP = require("./lib/json_safe_parse");
const server = require('http').createServer(app);
const TelegramEngine = require('./engine/telegram');
const bodyParser = require("body-parser");
const getDateTime = require('./lib/get_date_time');
const TokenEngine = require('./engine/token');
const CandlestickEngine = require('./engine/candlestick');
const Regex = require('./lib/regex');
const LaunchEngine = require('./kiko/launch');
const ObserverEngine = require('./kiko/observer');
const { obv } = require('technicalindicators');
const { WhaleEngine } = require('./engine/whale');
const { computeArithmeticDirectionMod } = require('./lib/mod_direction');


app.disable("x-powered-by");
app.disable('etag');

app.use(bodyParser.json({ limit: "35mb" }));
app.use(
    bodyParser.urlencoded({
        extended: true,
        limit: "35mb",
        parameterLimit: 50000,
    })
);

app.post("/webhook", (req, res) => {
    const receivedToken = req.headers["x-telegram-bot-api-secret-token"];
    if (receivedToken != Site.TG_WH_SECRET_TOKEN) {
        res.sendStatus(403);
        return;
    }
    TelegramEngine.processWebHook(req.body);
    res.sendStatus(200);
});

const startTime = getDateTime(Date.now());
app.get("/", (req, res) => {
    res.type("txt").send(`${Site.TITLE} running since ${startTime} ${process.env.TZ || "UTC"}`);
});

app.use((req, res, next) => {
    res.sendStatus(404);
});

app.use((err, req, res, next) => {
    Log.dev(err);
    res.sendStatus(500);
});

/**
 * This is called if initialization is successful, to continue setting up.
 */
const proceedAfterInit = () => {
    const ws = new WebSocket(Site.WS_URL);
    ws.on('open', () => {
        TokenEngine.registerSocket(ws);
        ObserverEngine.registerSocket(ws);
        Log.flow(`WebSocket > Connected.`, 4);

        if(!Site.TURN_OFF_KIKO){
            let payload = {
                method: "subscribeNewToken",
            }
            ws.send(JSON.stringify(payload));
        }

        if (TokenEngine.getTokensMint().length > 0) {
            let payload = {
                method: "subscribeTokenTrade",
                keys: TokenEngine.getTokensMint(),
            }
            ws.send(JSON.stringify(payload));
        }

        const observedTokens = Object.keys(ObserverEngine.tokens);
        if (observedTokens.length > 0) {
            let payload = {
                method: "subscribeTokenTrade",
                keys: observedTokens,
            }
            ws.send(JSON.stringify(payload));
        }
    });

    ws.on('close', () => {
        Log.flow(`WebSocket > Disconnected.`, 4);
        setTimeout(() => {
            proceedAfterInit();
        }, Site.WS_RECONNECTION_DELAY);
    });

    ws.on('error', (err) => {
        Log.flow(`WebSocket > Error > ${err.message}`, 4);
    });

    ws.on('message', async data => {
        const message = JSP(data);
        const keys = Object.keys(message);
        if (keys.length === 1 && keys[0] === 'message') {
            Log.flow(`WebSocket > Message > ${message.message}`, 4);
        }
        else {
            if (message.txType == "create") {
                // NEW TOKEN
                if (await LaunchEngine.check(message)) {
                    ObserverEngine.newToken(message);
                }
            }
            else if (message.txType == "buy" || message.txType == "sell") {
                // OTHER SUBSCRIBED TRANSACTIONS
                TokenEngine.newTrade(message);
                ObserverEngine.newTrade(message);
                WhaleEngine.newTrade(message);
            }
        }
    });
}

process.on('exit', async (code) => {
    const l = await CandlestickEngine.exit();
});

process.on('SIGINT', async () => {
    Log.flow('Process > Received SIGINT.');
    if (Site.TG_SEND_STOP) {
        TelegramEngine.sendMessage(`😴 ${Site.TITLE} stopped.`, r => {
            process.exit(0);
        });
    }
    else {
        process.exit(0);
    }
});

process.on('SIGTERM', async () => {
    Log.flow('Process > Received SIGTERM.');
    if (Site.TG_SEND_STOP) {
        TelegramEngine.sendMessage(`😴 ${Site.TITLE} stopped.`, r => {
            process.exit(0);
        });
    }
    else {
        process.exit(0);
    }
});

process.on('uncaughtException', async (err) => {
    Log.flow('Process > Unhandled exception caught.');
    console.log(err);
    if (Site.TG_SEND_STOP) {
        TelegramEngine.sendMessage(`😴 ${Site.TITLE} stopped.`, r => {
            if (Site.EXIT_ON_EXCEPTION) {
                process.exit(0);
            }
        });
    }
    else {
        if (Site.EXIT_ON_EXCEPTION) {
            process.exit(0);
        }
    }
});

process.on('unhandledRejection', async (err, promise) => {
    Log.flow('Process > Unhandled rejection caught.');
    console.log("Promise:", promise);
    console.log("Reason:", err);
    if (Site.TG_SEND_STOP) {
        TelegramEngine.sendMessage(`😴 *${Site.TITLE}* stopped`, r => {
            if (Site.EXIT_ON_REJECTION) {
                process.exit(0);
            }
        });
    }
    else {
        if (Site.EXIT_ON_REJECTION) {
            process.exit(0);
        }
    }
});


init(succ => {
    if (succ) {
        server.listen(Site.PORT, () => {
            Log.flow(`${Site.TITLE} > ${Site.URL}`);
            if (Site.TG_SEND_START) {
                setTimeout(() => {
                    TelegramEngine.sendMessage(`🚀 *${Site.TITLE}* started`);
                }, 1000);
            }
            proceedAfterInit();
        });
    }
    else {
        killer();
    }
});