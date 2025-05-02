const computeDynamicSuspicionScore = require("../lib/holders_sus_score");
const Site = require("../env");
const Log = require("../lib/log");
const { get } = require("../lib/make_request");
const calculateUniquenessScore = require("../lib/uniqueness_score");
const { ObserverToken, AuditData } = require("./kiko_model");

class AuditEngine {

    /**
     * Performs audit on a token
     * @param {ObserverToken} token 
     * @returns {Promise<any>}
     */
    static run = (token) => {
        return new Promise(async (resolve, reject) => {
            let temp = new AuditData();
            let auditSucc = true;
            const conclude = () => {
                Log.flow(`Audit > ${token.name} (${token.symbol}) > Concluded ${auditSucc ? `without error` : `with error`}.`, 4);
                resolve(auditSucc ? {human: temp.toReadableRecord(), raw: temp.toRawObject()} : null);
            }
            Log.flow(`Audit > ${token.name} (${token.symbol}) > Initialized.`, 4);
            /**
             * @type {Record<string, number>}
             */
            let holdersByPerc = {};
            Object.keys(token.holders).forEach(trader => {
                holdersByPerc[trader] = ((token.holders[trader] / token.circulating_supply) * 100);
            });

            /**
             * @returns {Promise<boolean>}
             */
            const auditDevOtherTokens = () => {
                return new Promise((resolve, reject) => {
                    get(`${Site.PF_API}/coins/user-created-coins/${token.developer}?limit=100&offset=0`, res => {
                        // console.log(res);
                        if (!res.succ) {
                            auditSucc = false;
                        }
                        else {
                            const coins = res.message.coins || [];
                            const totalTokens = coins.length;
                            const deployerHasOtherTokens = totalTokens > 1;
                            const totalOtherTokens = totalTokens - 1;
                            const ratio = (coins.filter(tok => (parseFloat(tok.market_cap) * (Site.BASE_DENOMINATED ? 1 : SolPrice.get())) >= Site.AD_DEV_OTHER_TOKENS_MC_THRESHOLD && tok.mint != token.mint).length / (totalOtherTokens));
                            const percOthersAboveThreshold = (ratio || 0) * 100;
                            temp.dev_other_tokens = deployerHasOtherTokens;
                            temp.dev_other_tokens_pass_perc = percOthersAboveThreshold;
                        }
                        resolve(res.succ);
                    });
                });
            }

            /**
             * @returns {Promise<boolean>}
             */
            const auditDevSelling = () => {
                return new Promise((resolve, reject) => {
                    const deployerSoldSome = (token.circulating_supply * ((token.holders[token.developer] ?? 0) / 100)) < token.dev_initial_buy;
                    temp.dev_sold_some = deployerSoldSome;
                    if (deployerSoldSome) {
                        temp.dev_sold_perc = Math.min(100, ((((Math.max(0, (token.dev_initial_buy - (token.holders[token.developer] ?? 0)))) / token.dev_initial_buy) * 100) || 0));
                    }
                    else {
                        temp.dev_sold_perc = 0;
                    }
                    temp.dev_hold_perc = (((token.holders[token.developer] ?? 0) / token.circulating_supply) * 100) || 0;
                    resolve(true);
                });
            }

            /**
             * @returns {Promise<boolean>}
             */
            const auditReplies = () => {
                return new Promise((resolve, reject) => {
                    get(`${Site.PF_API}/replies/${token.mint}?limit=2000&offset=0`, res => {
                        if (!res.succ) {
                            auditSucc = false;
                        }
                        else {
                            const replies = res.message.replies || [];
                            const totalReplies = replies.length;
                            const uniqueRepliers = (new Set(replies.map(reply => reply.user))).size || 0;
                            const uniqueRepliersPerc = (uniqueRepliers / replies.length * 100) || 0;
                            /**
                             * @type {string[]}
                             */
                            const repliesText = replies.map(reply => reply.text);
                            const uniqueTextScore = calculateUniquenessScore(repliesText) || 0;
                            temp.replies_count = totalReplies;
                            temp.replies_unique_repliers_perc = uniqueRepliersPerc;
                            temp.replies_unique_score = uniqueTextScore;
                        }
                        resolve(res.succ);
                    });
                });
            }

            /**
             * @returns {Promise<void>}
             */
            const auditHolders = () => {
                return new Promise((resolve, reject) => {
                    const holders = Object.keys(holdersByPerc).filter(trader => trader != token.developer);
                    const totalHolders = holders.length;
                    const topHoldersCount = Math.min(totalHolders, 10);
                    const sortedHolders = holders.sort((a, b) => holdersByPerc[b] - holdersByPerc[a]);
                    const topHolders = sortedHolders.slice(0, topHoldersCount);
                    const topHoldersTotalPerc = parseFloat((topHolders.reduce((sum, key) => sum + holdersByPerc[key], 0)).toFixed(3));
                    const susScore = computeDynamicSuspicionScore(holders.map(trader => token.holders[trader] || 0));
                    temp.holders_count = totalHolders;
                    temp.holders_top_perc = topHoldersTotalPerc;
                    temp.holders_sus_score = susScore;
                    resolve(true);
                });
            }

            /**
             * @returns {Promise<void>}
             */
            const auditSocials = () => {
                return new Promise((resolve, reject) => {
                    if (token.uri) {
                        get(token.uri.replace("ipfs.io", Site.IPFS_GATEWAY_HOST), res => {
                            // console.log(JSON.stringify(res, null, "\t"));
                            if (!res.succ) {
                                auditSucc = false
                            }
                            else {
                                if(res.message.telegram){
                                    temp.social_telegram = true;
                                }
                                else{
                                    temp.social_telegram = false;
                                }
                                if(res.message.twitter){
                                    temp.social_twitter = true;
                                }
                                else{
                                    temp.social_twitter = false;
                                }
                                if(res.message.website){
                                    temp.social_website = true;
                                }
                                else{
                                    temp.social_website = false;
                                }
                                if(res.message.description){
                                    token.description = res.message.description;
                                }
                            }
                            resolve(res.succ);
                        });
                    }
                    else {
                        resolve(true);
                    }
                });
            }

            const auditBuySell = () => {
                return new Promise((resolve, reject) => {
                    const volume = token.buy_volume_sol + token.sell_volume_sol;
                    const trades = token.buys + token.sells;
                    const mc = token.marketcapSol * (Site.BASE_DENOMINATED ? 1 : SolPrice.get());
                    const buyPerc = ((token.buys / trades) * 100) || 0;
                    const buyVolPerc = ((token.buy_volume_sol / volume) * 100) || 0;
                    const vol = volume * (Site.BASE_DENOMINATED ? 1 : SolPrice.get());
                    temp.marketcap = mc;
                    temp.volume = vol;
                    temp.trades = trades;
                    temp.buy_perc = buyPerc;
                    temp.buy_vol_perc = buyVolPerc;
                    resolve(true);
                });
            }

            await Promise.all([
                auditDevSelling(),
                auditDevOtherTokens(),
                auditHolders(),
                auditSocials(),
                auditReplies(),
                auditBuySell(),
            ]);

            conclude();
        })
    }
}

module.exports = AuditEngine;