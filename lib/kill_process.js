const Log = require("./log");
/**
 * A function that kills the process.
 */
const main = () => {
    Log.flow(`Process manually exitting.`, 0)
    process.exit(1);
}

module.exports = main;