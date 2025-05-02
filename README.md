# Miko

First off, this sourcecode is public because I figured out that most people would not know how to properly configure it (to the extent of competing against me, using it against me) without understanding how "degen" and this project works, so I do not have to really gatekeep it.

Miko, "Kiko-extended Milo", a high yield (profitable for me) and flexible degen script, is made from two other scripts "Milo" and "Kiko". Let me explain below:

- Kiko, my third degen script, was made when I needed to shift from running my "microserviced-networks" on cloud VMs to light-weight stateless (not entirely due to being able to recover from onchain after restart) scripts that are able to run on single low-performance node environments and utilize telegram bots for their UIs. Kiko is a fully automated bot that allows me to monitor newly launched tokens, strongly audit (holders, socials, buys, volumes, developer, everything else) them at some point, and trade them for profit. 

- While trading with Kiko, sometimes, I miss out on more profits made by the tokens I trade after my exit, So I needed some kind of one-click telegram-based manual trading assistant that allows me to add tokens (eatablished ones or very-profitable ones after Kiko is done with them), trade them instantly, or even create limit orders, so I made "Milo". It did all that, and also showed me real-time analysis whenever I needed.

- While trading established tokens on Milo, knowing fully well they are likely not to get rugged (compared to new ones), I needed some kind of real-time analysis to detect buy and sell points for me, so I brought in the candlestick analysis and signal generation techniques I picked up while automating my CEX bots, and I added candlestick data generation, analysis, signal generation and correction, and one-click buy/sell telegram alerts (short-lived messages) to Milo.

- Other issues with Milo was that I had to search for tokens to manually add them, and there is not a lot of profit to be made trading established degen tokens. I needed to add promising tokens at their early (mostly graduation) stages, so, with Kiko being flexible enough, I extended it and configured separate instances of it to simulate trading and forward successful tokens to Milo, including their audit results. I then no longer have to manually source for tokens, and can grab promising ones early enough.

- The previous solution let to me needing to run two different Node.JS scripts, wasting resources. I mitigated this by extending Milo with the features I needed from Kiko to monitor promising tokens from birth, audit them and trade them whenever, hence, "Miko".

- Unlike Kiko and my other degen scripts, Miko/Milo do not include wallet management, hence, not needing to mirror the wallet balance, take note of all fees and transactions, smartly increase per-trade capital to convert profits into capital for exponential growth and operate a hedgefund-like custom "grid" trading method that I utilize in my other bots. Miko also, by default, does not pay priority fees, due to its original nature of being a manual tool without needing superfast transaction executions, unlike my other scripts that have components to keep track of priority fee trends, and optimize the values they use.

- Also, I stripped off the options to use Pumpportal's lightning API to trade and TPU to submit local transactions since I barely use them.

- While trading with Miko, I found myself consistently creating limit orders targetting certain marketcap and other conditions, so I added features to automate these processes, added more risk-management, thereby making Miko flexible enough to be automated.

- So, Miko is not just a "Kiko-extended Milo", it is powerful enough, yet flexible to be configured for various cases, whether you are targeting established coins or just sniping newly created tokens. Its features include but not limited to the following:

    - Nevermind, I do not have the patience to write all these down.

    - This is not an ad for Miko.

    - Study the codes if you feel like.

    - Miko gets me the bag.

- Also, I have three separate NodeJS and Python based analysis projects that allow me to collect and parse telegram messages into meaningful records of data, analyse them, visualise them, and further strengthen my instances.

- I refuse to include my multiple configurations (.env files) because I feel like. Lucky you, you can actually reverse engineer one by checking how they are parsed in `env.js` and going to where they are referenced to see how they are used.

- Miko is quite a powerful tool, I assure you. Contact me to F things up.

- I give each of my script a personality, hence the ridiculous names (and pictures which are not included). Not important, but I've got other instances of Miko called Nova (automated, configured to follow promising tokens to the very end, extracting every possible profit) and Frostbyte (configured for high-frequency, low-marketcap, strict-audit sniping, including the priority fee tracker and decision maker).

God's speed!!!