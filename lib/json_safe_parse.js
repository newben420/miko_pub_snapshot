/**
 * Safely parses a JSON string to an object.
 * @param {any} data - JSON string.
 * @param {boolean} isArray - Indicates if expected object is an array.
 * @returns {any} - object.
 */
const main = (data, isArray = false) => {
    let obj = isArray ? [] : {};
    try {
        obj = JSON.parse(data);
    } catch (error) {
        // do nothing
    }
    finally{
        return obj;
    }
}

module.exports = main;