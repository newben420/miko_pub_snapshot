const { NextFunction, Request, Response } = require("express");
const Site = require("./../env");
const { sign, verify } = require("jsonwebtoken");
const getTimeElapsed = require("../lib/get_time_elapsed");
const getDateTime = require("../lib/get_date_time");
const Log = require("../lib/log");

const startTime = getDateTime(Date.now());

/**
 * Responsible for HTTP authentication when enabled
 */
class AuthEngine {

    static #redirectURL = "/";

    /**
     * Actually signs JWT.
     * @param {any} payload 
     * @param {string} userSecret 
     * @returns {Promise<string|null>}
     */
    static #signToken = (payload, userSecret) => {
        return new Promise((resolve, reject) => {
            let options = {
                algorithm: 'HS256'
            };
            options.expiresIn = Math.ceil(Site.UI_AUTH_SESS_EXP_MS / 1000);
            sign(payload, `${Site.UI_AUTH_JWT_SECRET_PREFIX}${userSecret}`, options, (err, token) => {
                if (err || !token) {
                    Log.dev(err || "ERROR - JWT signing could not produce a token.");
                    resolve(null);
                }
                else {
                    resolve(token);
                }
            });
        });
    }

    /**
     * JWT signing middleware that generates payload.
     * @param {string} username 
     * @param {string} userJWTSecret
     * @returns {Promise<null|string>} JWT token
     */
    static #signJWT = (username, userJWTSecret) => {
        return new Promise(async (resolve, reject) => {
            let payload = {};
            payload.sub = username;
            payload.iat = Math.ceil(Date.now() / 1000);
            payload.iss = Site.UI_AUTH_JWT_ISSUER;
            resolve(await AuthEngine.#signToken(payload, userJWTSecret));
        })
    }

    /**
     * Generates cookie options.
     */
    static cookieOpts = () => {
        return {
            httpOnly: true,
            secure: Site.PRODUCTION ? true : false,
            sameSite: Site.PRODUCTION ? 'strict' : 'none',
            signed: true,
        };
    }

    /**
     * Generates cookie expiration Date object.
     * @param {number} duration  - in ms.
     * @returns {Date}
     */
    static cookieExp = (duration) => (new Date(Number(new Date()) + Number(duration)));

    /**
     * Gets JWT from cookie.
     * @param {Request} req 
     * @returns {Promise<Record<string, any>|null>} {username, token} if found else null.
     */
    static #getJWTFromCookie = (req) => {
        return new Promise((resolve, reject) => {
            let u = req.signedCookies[Site.UI_AUTH_JWT_COOKIE_NAME];
            let jwt = req.signedCookies[(Site.UI_AUTH_JWT_COOKIE_NAME + "_jwt")];
            // for legacy.. to support older browsers
            let ul = req.signedCookies[Site.UI_AUTH_JWT_COOKIE_NAME + "_legacy"];
            let jwtl = req.signedCookies[(Site.UI_AUTH_JWT_COOKIE_NAME + "_jwt_legacy")];
            if (u && jwt) {
                resolve({ username: u, token: jwt });
            }
            else if (ul && jwtl) {
                resolve({ username: ul, token: jwtl });
            }
            else {
                resolve(null);
            }
        });
    }

    /**
     * Saves JWT to cookie.
     * @param {Response} res 
     * @param {string} username 
     * @param {string} token 
     * @returns {Promise<boolean>} true if done else false.
     */
    static #saveJWTToCookie = (res, username, token,) => {
        return new Promise((resolve, reject) => {
            let cookOpts = AuthEngine.cookieOpts();
            const exp = AuthEngine.cookieExp(Site.UI_AUTH_COOK_EXP_MS);
            cookOpts.expires = exp;
            res.cookie(Site.UI_AUTH_JWT_COOKIE_NAME, username, cookOpts);
            res.cookie(Site.UI_AUTH_JWT_COOKIE_NAME + "_jwt", token, cookOpts);
            // for legacy support
            let cop_opts = AuthEngine.cookieOpts();
            delete cop_opts.sameSite;
            cop_opts.expires = exp;
            // set legacy cookies here
            res.cookie(Site.UI_AUTH_JWT_COOKIE_NAME + "_legacy", username, cop_opts);
            res.cookie(Site.UI_AUTH_JWT_COOKIE_NAME + "_jwt_legacy", token, cop_opts);
            resolve(true);
        });
    }

    /**
     * Generates random string to be used as login path whenever the app is restarted.
     * @param {number} [length=20] 
     * @returns {string}
     */
    static #generateRandomString = (length = 20) => {
        const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += characters.charAt(Math.floor(Math.random() * characters.length));
        }
        return result;
    }

    static #loginPath = AuthEngine.#generateRandomString(20);

    /**
     * Verifies a session
     * @param {string} username 
     * @param {string} userSecret 
     * @param {string} token 
     * @returns {Promise<Record<string, any>|null>} {payload, newToken?} if verified, else null. If token is present in record, a new one has been generated and needs to be saved.
     */
    static verifySession = (username, userSecret, token) => {
        return new Promise((resolve, reject) => {
            let ts = Date.now();
            if (username) {
                let secret = `${Site.UI_AUTH_JWT_SECRET_PREFIX}${userSecret}`;
                let options = {
                    algorithms: ["HS256", "HS384"],
                    issuer: Site.UI_AUTH_JWT_ISSUER,
                    ignoreExpiration: false,
                    subject: username,
                    clockTolerance: 120,
                    maxAge: `${Site.UI_AUTH_SESS_EXP_MS}ms`,
                    clockTimestamp: Math.ceil(Date.now() / 1000),
                }
                verify(token, secret, options, async (error, payload) => {
                    if (error) {
                        Log.dev(error);
                        resolve(false);
                    }
                    else {
                        if (payload) {
                            try {
                                if (payload.exp) {
                                    // check if token is almost expiring and issue a new one
                                    let exp = (payload.exp || 0) * 1000;
                                    if (exp - Date.now() < Site.UI_AUTH_JWT_RENEW_TIMELEFT_MS) {
                                        // renew an almost expiring jwt
                                        let curr_iat = (payload.iat || 0) + 0;
                                        let curr_exp = exp + 0;
                                        let pl = payload;
                                        delete pl.exp;
                                        pl.iat = Date.now();
                                        let token = await AuthEngine.#signToken(pl, userSecret);
                                        if (token) {
                                            pl.iat = curr_iat;
                                            pl.exp = curr_exp;
                                            resolve({ payload: payload, newToken: token });
                                        }
                                        else {
                                            // ignore error messages here since incoming jwt is already verified
                                            resolve({ payload: payload });
                                        }
                                    }
                                    else {
                                        resolve({ payload: payload });
                                    }
                                }
                                else {
                                    resolve({ payload: payload });
                                }
                            } catch (error) {
                                Log.dev(error);
                                resolve(null);
                            }
                        }
                        else {
                            resolve(null);
                        }
                    }
                });
            }
            else {
                resolve(null);
            }
        });
    }

    /**
     * @type {Record<string, Record<string, number>>}
     */
    static #IPBlacklist = {};

    /**
     * Authenticates user submitted details against server's.
     * @param {string} ip 
     * @param {string} username 
     * @param {string} password 
     */
    static #authenticate = (ip, username, password) => {
        const auth = (username == Site.UI_AUTH_USERNAME) && (password == Site.UI_AUTH_PASSWORD);

        // Clear outdated IPs from blacklist register.
        Object.keys(AuthEngine.#IPBlacklist).forEach(i => {
            if ((Date.now() - (AuthEngine.#IPBlacklist[i].lu || 0)) > Site.UI_AUTH_IPBLACKLIST_MAX_DURATION_MS) {
                delete AuthEngine.#IPBlacklist[i];
            }
        });

        // Work with blacklist
        if (!AuthEngine.#IPBlacklist[ip]) {
            AuthEngine.#IPBlacklist[ip] = { fl: 0, lu: Date.now() };
        }

        if (auth) {
            AuthEngine.#IPBlacklist[ip].fl = 0;
        }
        else {
            AuthEngine.#IPBlacklist[ip].fl += 1;
        }

        const notBlocked = AuthEngine.#IPBlacklist[ip].fl <= Site.UI_AUTH_MAX_FAILED_LOGIN_ATTEMPTS;

        return {
            auth: auth && notBlocked,
            blocked: !notBlocked,
        };
    };

    /**
     * A middleware that verifies sessions for http requests.
     * @param {Request} req 
     * @param {Response} res 
     * @returns {Promise<boolean>}
     */
    static #httpVerifiySession = (req, res) => {
        return new Promise(async (resolve, reject) => {
            const cook = await AuthEngine.#getJWTFromCookie(req);
            if (cook) {
                const { username, token } = cook;
                if (username && token && username == Site.UI_AUTH_USERNAME) {
                    const verified = await AuthEngine.verifySession(username, Site.UI_AUTH_JWT_USER_SECRET, token);
                    if (verified) {
                        const { payload, newToken } = verified;
                        if (newToken) {
                            const saved = await AuthEngine.#saveJWTToCookie(res, username, newToken);
                            resolve(true);
                        }
                        else {
                            resolve(true);
                        }
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
                resolve(false);
            }
        });
    }

    /**
     * Clears session variables for logging out.
     * @param {Response} res 
     * @returns {Promise<boolean>}
     */
    static #logout = (res) => {
        return new Promise((resolve, reject) => {
            res.clearCookie(Site.UI_AUTH_JWT_COOKIE_NAME);
            res.clearCookie(Site.UI_AUTH_JWT_COOKIE_NAME + "_legacy");
            res.clearCookie((Site.UI_AUTH_JWT_COOKIE_NAME + "_jwt"));
            res.clearCookie((Site.UI_AUTH_JWT_COOKIE_NAME + "_jwt_legacy"));
            resolve(true);
        });
    }

    /**
     * Requests are routed through this middleware.
     * @param {Request} req
     * @param {Response} res
     * @param {NextFunction} next
     */
    static entry = async (req, res, next) => {
        if (Site.UI) {
            if (Site.UI_AUTH) {
                if (Site.UI_AUTH_BYPASSED_PATHS.indexOf(req.path) > -1) {
                    next();
                }
                else {
                    if ((await AuthEngine.#httpVerifiySession(req, res))) {
                        // session verified
                        if (req.path == `/logout` && req.method.toString().toLowerCase() == "get") {
                            // Logout and redirect.
                            const done = await AuthEngine.#logout(res);
                            if (done) {
                                res.redirect(AuthEngine.#loginPath || req.headers['referer'] || AuthEngine.#redirectURL);
                            }
                            else {
                                next();
                            }
                        }
                        else {
                            // continue
                            next();
                        }
                    }
                    else {
                        // session could not be verified.
                        if (req.path == `/${AuthEngine.#loginPath}` && req.method.toString().toLowerCase() == "post") {
                            // Login submission
                            let bd = req.body;
                            let un = bd.username;
                            let pw = bd.password;
                            if (un && pw) {
                                const { auth, blocked } = AuthEngine.#authenticate(req.ip || "unspecified", un, pw);
                                if (auth) {
                                    // authenticated;
                                    const token = await AuthEngine.#signJWT(un, Site.UI_AUTH_JWT_USER_SECRET);
                                    if (token) {
                                        const saved = await AuthEngine.#saveJWTToCookie(res, un, token);
                                        if (saved) {
                                            res.redirect(AuthEngine.#redirectURL);
                                        }
                                        else {
                                            AuthEngine.#sendLoginPage(res, 'Token could not be saved.');
                                        }
                                    }
                                    else {
                                        AuthEngine.#sendLoginPage(res, 'Token could not be generated.');
                                    }
                                }
                                else {
                                    AuthEngine.#sendLoginPage(res, blocked ? `You are blocked. Try again in ${getTimeElapsed(0, Site.UI_AUTH_IPBLACKLIST_MAX_DURATION_MS)}.` : 'Username/password do not match.');
                                }
                            }
                            else {
                                AuthEngine.#sendLoginPage(res, 'All fields are required.');
                            }
                        }
                        else if(req.path == `/${AuthEngine.#loginPath}` && req.method.toString().toLowerCase() == "get"){
                            res.redirect("/login");
                        }
                        else {
                            AuthEngine.#sendLoginPage(res);
                        }
                    }
                }
            }
            else {
                next();
            }
        }
        else {
            if (req.path == "/") {
                res.type("txt").send(`${Site.TITLE} running since ${startTime} ${process.env.TZ || "UTC"}`);
            }
            else {
                next();
            }
        }
    }

    /**
     * Sends user a login page.
     * @param {Response} res 
     * @param {string} [error=""] 
     */
    static #sendLoginPage = (res, error = "") => {
        let htm = `
        <!DOCTYPE html>
        <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>401 | ${Site.TITLE}</title>
                <style>
                    *{box-sizing: border-box;font-family: 'Courier New', Courier, monospace;outline: none;}
                    body{margin:0px;padding:0px; background:#191c1e;font-size: 100%;}
                    .contain{padding:10px; margin: 50px auto; width: 100%; max-width: 500px;text-align: center;overflow:hidden;}
                    .inner-contain{width: 100%; padding: 20px; background: #212529;border-radius: 10px;-moz-border-radius: 10px;-webkit-border-radius: 10px;-o-border-radius: 10px;}
                    h1{text-align: center; padding:10px 0px;margin:0px;margin-bottom:10px; color:#fff;font-size: 2rem;font-weight: 300;overflow: hidden;}
                    form{width: 100%; overflow: hidden;}
                    input{width: 100%; background-color: #fff; font-weight: normal;color: #191c1e; font-size: 1rem; margin-bottom: 30px;padding: 10px;border:none;border-radius: 5px;-moz-border-radius: 5px;-webkit-border-radius: 5px;-o-border-radius: 5px;}
                    button{width: 100%; cursor: pointer; background-color: #198754; font-weight: 500;color: #fff; font-size: 1rem; padding: 10px;border:none;border-radius: 5px;-moz-border-radius: 5px;-webkit-border-radius: 5px;-o-border-radius: 5px; margin-bottom: 10px}
                    span.error{font-size: 0.8rem; padding-bottom: 20px; display: block; color: #dc3545; font-weight: normal; overflow: hidden; text-align: center; width: 100%;}
                </style>
            </head>
            <body>
                <div class="contain">
                    <div class="inner-contain">
                        <h1>${Site.TITLE}</h1>
                        ${error ? `<span class="error">${error}</span>` : ''}
                        <form action="/${AuthEngine.#loginPath}" method="post">
                            <input placeholder="Username" type="text" name="username" required>
                            <input placeholder="Password" type="password" name="password" required>
                            <button type="submit">Sign in</button>
                        </form>
                    </div>
                </div>
            </body>
        </html>
        `;
        res.status(401);
        res.type('html');
        res.send(htm);
    }
}

module.exports = AuthEngine;