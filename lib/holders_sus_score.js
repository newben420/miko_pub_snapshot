
/**
 * Computes a dynamic suspicion score for token allocations to help detect potential bot activity.
 *
 * This version avoids fixed thresholds. Instead, it derives dynamic bounds based on the input data.
 * Two metrics are combined:
 *
 * 1. Dynamic CV Score:
 *    - Calculates the coefficient of variation (CV) from the allocations.
 *    - Uses a dynamic maximum CV (maxCV) approximated by sqrt(n - 1) for n allocations.
 *    - A CV of 0 (perfect uniformity) yields a score of 100, while a CV of maxCV yields 0.
 *
 * 2. Dynamic Frequency Score:
 *    - Constructs a frequency map to determine the most common allocation.
 *    - The lowest possible maximum frequency is 1/n (all values unique) and the highest is 1.
 *    - Scores are scaled so that a max frequency of 1/n returns 0 and a frequency of 1 returns 100.
 *
 * The final suspicion score (0 to 100) is the average of these two metrics.
 *
 * @param {number[]} allocations - Array of token holdings per wallet.
 * @returns {number} A dynamic suspicion score between 0 (not suspicious) and 100 (highly suspicious).
 */
function computeDynamicSuspicionScore(allocations) {
    if (!allocations || allocations.length === 0) return 0;

    const n = allocations.length;

    // Compute mean and standard deviation.
    const sum = allocations.reduce((acc, val) => acc + val, 0);
    const mean = sum / n;
    const variance = allocations.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / n;
    const stdDev = Math.sqrt(variance);

    // Compute coefficient of variation (CV).
    const cv = mean !== 0 ? stdDev / mean : 0;
    // Dynamic upper bound for CV (approximation: one value is high, rest near zero)
    const maxCV = Math.sqrt(n - 1);
    // Dynamic CV score: 100 when cv==0, 0 when cv==maxCV (clamped within [0, 100])
    const suspicionCV = Math.min(Math.max(100 * (1 - (cv / maxCV)), 0), 100);

    // Build frequency map for the allocations.
    const frequencyMap = {};
    allocations.forEach(val => {
        frequencyMap[val] = (frequencyMap[val] || 0) + 1;
    });

    // Determine the maximum frequency proportion.
    const maxFrequency = Math.max(...Object.values(frequencyMap));
    const maxFreqProportion = maxFrequency / n;
    // The minimum possible max frequency is when all values are unique: 1/n.
    const minFreq = 1 / n;
    // Dynamic frequency score: scales from 0 (if maxFreqProportion == minFreq) to 100 (if maxFreqProportion == 1)
    const suspicionFreq = Math.min(
        Math.max(100 * ((maxFreqProportion - minFreq) / (1 - minFreq)), 0),
        100
    );

    // Final suspicion score is the average of the two metrics.
    const suspicionScore = (suspicionCV + suspicionFreq) / 2;

    return suspicionScore || 100;
}

module.exports = computeDynamicSuspicionScore;