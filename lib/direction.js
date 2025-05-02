const Site = require("../env");

/**
 * Computes direction with equal weights.
 * @param {number[]} arr - Data array.
 * @param {number} points - Number of latest points to use for computation. 2 is default and minimum.
 * @returns {1|0|-1} - 1 for upward. 0 for non-deterministic. -1 for downward.
 */
const computeArithmeticDirection = (arr, points = 2) => {
    if (points < 2) {
        points = 2;
    }
    if (arr.length < points) {
        return 0;
    }
    arr = arr.slice(arr.length - points);
    let direction = 0;
    for (let i = 1; i < points; i++) {
        if ((arr[i] || arr[i] === 0) && (arr[i - 1] || arr[i - 1] === 0)) {
            if (arr[i] > arr[i - 1]) {
                direction++;
            }

            if (arr[i] < arr[i - 1]) {
                direction--;
            }
        }
    }
    return (direction >= 1) ? 1 : ((direction <= -1) ? -1 : 0);
}

/**
 * Computes direction exponentially with incremental weights.
 * @param {number[]} arr - Data array.
 * @param {number} points - Number of latest points to use for computation. 2 is default and minimum.
 * @returns {1|0|-1} - 1 for upward. 0 for non-deterministic. -1 for downward.
 */
const compute1ExpDirection = (arr, points = 2) => {
    if (points < 2) {
        points = 2;
    }
    if (arr.length < points) {
        return 0;
    }
    arr = arr.slice(arr.length - points);
    let direction = 0;
    for (let i = 1; i < points; i++) {
        if ((arr[i] || arr[i] === 0) && (arr[i - 1] || arr[i - 1] === 0)) {
            if (arr[i] > arr[i - 1]) {
                direction += (i);
            }

            if (arr[i] < arr[i - 1]) {
                direction -= (i);
            }
        }
    }
    return (direction >= 1) ? 1 : ((direction <= -1) ? -1 : 0);
}

/**
 * Computes direction exponentially with 2x incremental weights.
 * @param {number[]} arr - Data array.
 * @param {number} points - Number of latest points to use for computation. 2 is default and minimum.
 * @returns {1|0|-1} - 1 for upward. 0 for non-deterministic. -1 for downward.
 */
const compute2ExpDirection = (arr, points = 2) => {
    if (points < 2) {
        points = 2;
    }
    if (arr.length < points) {
        return 0;
    }
    arr = arr.slice(arr.length - points);
    let direction = 0;
    for (let i = 1; i < points; i++) {
        if ((arr[i] || arr[i] === 0) && (arr[i - 1] || arr[i - 1] === 0)) {
            if (arr[i] > arr[i - 1]) {
                direction += (i * 2);
            }

            if (arr[i] < arr[i - 1]) {
                direction -= (i * 2);
            }
        }
    }
    return (direction >= 1) ? 1 : ((direction <= -1) ? -1 : 0);
}

/**
 * Computes clear direction based on difference.
 * @param {number[]} arr - Data array. Minimum length is 2.
 * @param {number} l - Number of latest points to use for computation.
 * @returns {1|0|-1} - 1 for upward. 0 for non-deterministic. -1 for downward.
 */
const clearDirection = (arr, l) => {
    if (arr.length < 2) {
        return 0;
    }
    if (arr.length > l) {
        arr = arr.slice(arr.length - l);
    }
    let d = 0;
    for (let i = 1; i < arr.length; i++) {
        if ((arr[i] || arr[i] === 0) && (arr[i - 1] || arr[i - 1] === 0)) {
            if (arr[i] > arr[i - 1]) {
                d += (arr[i] - arr[i - 1]);
            }
            if (arr[i] < arr[i - 1]) {
                d -= (arr[i - 1] - arr[i]);
            }
        }
    }

    return d > 0 ? 1 : (d < 0 ? -1 : 0);
}

/**
 * This returns dirLength based on length of data and env configurations.
 * @param {number} dataLength - Length of data.
 * @returns {number}
 */
const computeDirLength = (dataLength) => {
    return Math.min(Math.ceil(Site.IND_DIR_LEN_PERC * dataLength), Site.IND_DIR_LEN_MAX);
}

module.exports = { compute1ExpDirection, compute2ExpDirection, computeArithmeticDirection, clearDirection, computeDirLength };