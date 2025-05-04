/**
 * Computes direction with equal weights.
 * @param {number[]} arr - Data array.
 * @param {number} points - Number of latest points to use for computation. 2 is default and minimum.
 * @returns {string} - 1 for upward. 0 for non-deterministic. -1 for downward.
 */
const computeArithmeticDirectionMod = (arr, points = 2) => {
    // if (arr.length < 2) {
    //     return `Undecided`;
    // }
    if (arr.length > points) {
        arr = arr.slice(arr.length - points);
    }
    arr = arr.map(v => {
        if(v < 0){
            return -1;
        }
        if(v > 0){
            return 1;
        }
        return 0;
    });
    arr = arr.map((v, i) => v * (i + 1));
    let direction = arr.reduce((a, b) => a + b, 0);
    let max = (new Array(arr.length)).fill(1).map((v, i) => v * (i + 1)).reduce((a, b) => a + b, 0);
    let min = (new Array(arr.length)).fill(-1).map((v, i) => v * (i + 1)).reduce((a, b) => a + b, 0);
    let scaledToTen = ((direction - min) / (max - min)) * 10;
    let sentiment = "🤔 Undecided";
    if(scaledToTen >= 0 && scaledToTen < 3) sentiment = "📛 Terrible";
    if(scaledToTen >= 3 && scaledToTen < 4) sentiment = "🤬 Bad";
    if(scaledToTen >= 4 && scaledToTen < 6) sentiment = "😐 Neutral";
    if(scaledToTen >= 6 && scaledToTen < 8) sentiment = "😋 Good";
    if(scaledToTen >= 8 && scaledToTen < 10) sentiment = "😌 Better";
    if(scaledToTen >= 10) sentiment = "☺️ Excellent";
    if(arr.length < 2) sentiment = "🤔 Undecided";
    return sentiment;
}

module.exports = { computeArithmeticDirectionMod }