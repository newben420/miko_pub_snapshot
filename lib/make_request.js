const axios = require("axios");
const https = require("https");
const { Res } = require("./res");
const Site = require("./../env");
const Log = require("./log");
const dns = require("dns");
const DEF_ERROR = "INTERFACE"

/**
 * Makes GET requests.
 * @param {string} url - full url. 
 * @param {Function} callback - callback function with a Res parameter.
 * @param {any} headers - optional HTTP headers object.
 */

const agent = new https.Agent({
    lookup: (hostname, options, callback) => {
        dns.lookup(hostname, { ...options, family: 4 }, callback);
        // dns.lookup(hostname, {family: 6}, callback);
    }
})

const get = (url, callback, headers = {}) => {
    let called = false;
    axios.get(url, {
        timeout: Site.HTTP_TIMEOUT,
        headers,
        validateStatus: (status) => {
            return status >= 200 && status < 300 || status === 304;
        },
        httpsAgent: agent,
    }).then(res => {
        if (res.status == 200 || res.status == 304) {
            if (!called) {
                called = true;
                callback(new Res(true, res.data));
            }
        }
        else {
            Log.dev(err);
            if (!called) {
                called = true;
                callback(new Res(false, DEF_ERROR));
            }
        }
    }).catch(error => {
        Log.dev(error);
        try {
            if (error.response.data) {
                if (!called) {
                    called = true;
                    callback(new Res(false, error.response.data));
                }
            }
            else {
                if (!called) {
                    called = true;
                    callback(new Res(false, DEF_ERROR));
                }
            }
        }
        catch (err) {
            Log.dev(err);
            if (!called) {
                called = true;
                callback(new Res(false, DEF_ERROR));
            }
        }
    });
}

/**
 * Makes POST requests.
 * @param {string} url - full url.
 * @param {any} body - request body.
 * @param {Function} callback - callback function with a Res parameter.
 * @param {any} headers - optional HTTP headers object.
 */
const post = (url, body, callback, headers = {}) => {
    axios.post(url, body, {
        timeout: Site.HTTP_TIMEOUT,
        headers,
        validateStatus: (status) => {
            return status >= 200 && status < 300 || status === 304;
        },
        httpsAgent: agent,
    }).then(res => {
        if (res.status == 200 || res.status == 304) {
            callback(new Res(true, res.data));
        }
        else {
            Log.dev(err);
            callback(new Res(false, DEF_ERROR));
        }
    }).catch(error => {
        // Log.dev(error);
        try {
            if (error.response.data) {
                callback(new Res(false, error.response.data));
            }
            else {
                callback(new Res(false, DEF_ERROR));
            }
        }
        catch (err) {
            callback(new Res(false, DEF_ERROR));
        }
    });
}

module.exports = { get };