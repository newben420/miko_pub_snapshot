const natural = require("natural");
const stringSimilarity = require("string-similarity");

/**
 * Calculates uniqueness score based on the similarity between replies.
 * @param {string[]} replies 
 * @returns {number} - Uniqueness score (0-100 scale).
 */
const calculateUniquenessScore = (replies) => {
    let totalSimilarity = 0;
    let comparisons = 0;

    for (let i = 0; i < replies.length; i++) {
        for (let j = i + 1; j < replies.length; j++) {
            let text1 = replies[i];
            let text2 = replies[j];

            // Levenshtein similarity (normalized)
            const maxLen = Math.max(text1.length, text2.length);
            const levenshteinDistance = natural.LevenshteinDistance(text1, text2);
            const levenshteinSimilarity = 1 - (levenshteinDistance / maxLen);

            // String similarity (0-1 scale)
            const similarity = stringSimilarity.compareTwoStrings(text1, text2);

            // Average similarity
            const avgSimilarity = (levenshteinSimilarity + similarity) / 2;
            totalSimilarity += avgSimilarity;
            comparisons++;
        }
    }

    // Final uniqueness score (inverted similarity)
    const avgSimilarityScore = totalSimilarity / comparisons;
    const uniquenessScore = (1 - avgSimilarityScore) * 100;

    return Number(uniquenessScore.toFixed(2)) || 0;
}

module.exports = calculateUniquenessScore;