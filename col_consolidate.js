const fs = require("fs");
const path = require("path");

/**
 * Consolidates collected data into a single file
 */
const collectorConsolidate = () => {
    let srcPth = path.join(__dirname, "collected");
    let d = new Date();
    let dstPth = path.join(__dirname, `ml_con_${d.getFullYear().toString().padStart(2, '0')}${(d.getMonth() + 1).toString().padStart(2, '0')}${(d.getDate()).toString().padStart(2, '0')}${d.getHours().toString().padStart(2, '0')}${d.getMinutes().toString().padStart(2, '0')}${d.getSeconds().toString().padStart(2, '0')}.json`);
    const files = fs.readdirSync(srcPth).filter(x => /^[\d]+\.json$/.test(x)).map(x => parseInt(x.replace(".json", ""))).sort((a, b) => a - b);
    /**
     * @type {Record<string, any[]>}
     */
    let obj = {};
    for (let i = 0; i < files.length; i++) {
        let file = files[i];
        let content = JSON.parse(fs.readFileSync(path.join(srcPth, `${file}.json`), "utf8"));
        let keys = Object.keys(content);
        for (let j = 0; j < keys.length; j++) {
            let mint = keys[j];
            if (!obj[mint]) {
                obj[mint] = [];
            }
            obj[mint] = obj[mint].concat(content[mint]);
        }
        fs.unlinkSync(path.join(srcPth, `${file}.json`));
    }
    if (Object.keys(obj).length) {
        fs.writeFileSync(dstPth, JSON.stringify(obj, null, "\t"), "utf8");
        console.log(`Consolidated content saved to ${dstPth}`);
    }
    else {
        console.log("No content to consolidate");
    }
}

collectorConsolidate();