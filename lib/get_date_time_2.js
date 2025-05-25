/**
 * Returns a human readable date string from an epoch timestamp.
 * @param {number | string} ts - optional epoch timestamp.
 * @returns {string}
 */
const getDateTime2 = (ts =  Date.now()) => {
    // Ensure `ts` is a number
    if (typeof ts === "string") {
        ts = parseInt(ts || "0", 10);
    }
    const date = new Date(ts);
    // Arrays for abbreviated day and month names
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    // Extract values
    const day = days[date.getDay()];
    const month = months[date.getMonth()];
    const dd = date.getDate().toString().padStart(2, "0");
    const yyyy = date.getFullYear();
    const hh = date.getHours();
    const mm = date.getMinutes().toString().padStart(2, "0");
    const ss = date.getSeconds().toString().padStart(2, "0");
    // Determine AM/PM and format hour
    const period = hh >= 12 ? "PM" : "AM";
    const hour12 = hh % 12 || 12; // Convert 0 or 24 to 12, and keep 1-12 as is
    // Human-friendly format: "Tue, 14 Feb 2025 02:30:15 PM"
    // return ``;
    return `${hour12.toString()}:${mm}:${ss} ${period} - `;
}

module.exports = getDateTime2;