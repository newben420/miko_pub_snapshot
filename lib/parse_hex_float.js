/**
 * @param {string} hex 
 * @returns {number}
 */
function parseHexFloat(hex) {
    if (!hex.includes(".")) return parseInt(hex, 16);

    const [intPart, fracPart] = hex.split(".");
    const intVal = parseInt(intPart, 16);
    let fracVal = 0;

    for (let i = 0; i < fracPart.length; i++) {
        const digit = parseInt(fracPart[i], 16);
        fracVal += digit / Math.pow(16, i + 1);
    }

    return intVal + fracVal;
}

module.exports = parseHexFloat;