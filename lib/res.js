class Res {
    /**
     * @type {boolean}
     */
    succ;

    /**
     * @type {any}
     */
    message;

    /**
     * Creates a new response object.
     * @param {boolean} succ - Indicates success or failure.
     * @param {any} message - The response message.
     */
    constructor(succ, message = "") {
        this.succ = succ;
        this.message = message;
    }
}

module.exports = { Res };