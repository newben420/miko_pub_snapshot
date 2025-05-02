/**
 * Computes a single major boolean value from an array of boolean values.
 * @param {boolean[]} arr 
 * @param {number} threshold 
 * @returns {boolean}
 */
const booleanThreshold = (arr, threshold = 0.5) => {
    let n = arr.length;
    if(n == 0){
        return false;
    }
    let truths = 0;
    for(let i = 0; i < n; i ++){
        if(arr[i]){
            truths++;
        }
    }
    let truthRatio = truths / n;
    return truthRatio >= threshold;
}

module.exports = booleanThreshold;