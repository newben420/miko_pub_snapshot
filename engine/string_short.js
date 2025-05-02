/**
 * StringShortener
 * 
 * A static class for encoding long strings into short one-time-use codes.
 * Uses a counter to manage concurrent decoding operations.
 * 
 * Features:
 * - In-memory mapping (no persistence)
 * - Random short code generation
 * - One-time decode: decoding deletes the mapping when done
 * - Handles concurrent decoding and deletion safely with counters
 * 
 * Env Vars:
 * SHORTENER_CODE_LENGTH - Optional: set code length (default: 6)
 */

const Site = require("../env");

class StringShortener {
    static #map = new Map();          // code -> original string
    static #reverseMap = new Map();   // original string -> code
    static #counterMap = new Map();   // code -> counter of how many active decodes
    static #charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    static #codeLength = Site.STRING_SHORT_CODE_LENGTH;

    /**
     * Generates a random short code that hasn't been used yet.
     * @returns {string} A unique short code
     * @private
     */
    static #generateCode() {
        let code;
        do {
            code = Array.from({ length: this.#codeLength }, () =>
                this.#charset[Math.floor(Math.random() * this.#charset.length)]
            ).join('');
        } while (this.#map.has(code));
        return code;
    }

    /**
     * Encodes a long string into a short code.
     * If the string was previously encoded and not yet used, it returns the same code.
     * This method ensures that concurrent calls for the same string always generate the same code.
     * 
     * @param {string} str - The long string to encode
     * @returns {string} A short code representing the string
     */
    static encode(str) {
        // Check if the string already has a code
        if (this.#reverseMap.has(str)) {
            return this.#reverseMap.get(str); // Return the existing code
        }

        // If no code exists, generate one
        const code = this.#generateCode();
        this.#map.set(code, str);
        this.#reverseMap.set(str, code);
        this.#counterMap.set(code, 0); // Initialize counter for the code
        return code;
    }

    /**
     * Decodes a short code back to the original string.
     * This operation is destructive — the mapping is deleted after decoding.
     * 
     * @param {string} code - The short code to decode
     * @returns {string|null} The original string if found, else null
     */
    static decode(code) {
        const original = this.#map.get(code);
        if (original) {
            // Increment the decode counter for this code
            this.#counterMap.set(code, this.#counterMap.get(code) + 1);

            // Now, delete the mapping and reverse map
            this.#map.delete(code);
            this.#reverseMap.delete(original);

            // Decrement the counter and delete the code if no more decodes are active
            setImmediate(() => {
                if (this.#counterMap.get(code) > 0) {
                    this.#counterMap.set(code, this.#counterMap.get(code) - 1);
                }
                if (this.#counterMap.get(code) === 0) {
                    this.#counterMap.delete(code); // Clean up when counter reaches 0
                }
            });

            return original;
        }
        return null;
    }
}

module.exports = StringShortener;
