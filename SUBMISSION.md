# Backstop: Devpost submission

Copy each section into the matching Devpost field. Items marked **TODO** need filling in before submitting.

## Project name

Backstop

## Short description (one line)

Hedge a real-world event in one click: USDC cover on Arc, priced from Gemini prediction-market odds, hedged on Gemini, and run by a Grok agent that buys cover on its own.

## Team members

**TODO:** names (and Devpost handles) of every team member.

## Track, chain award, bounties

- **Main track:** DeFi and Onchain Applications
- **Chain award:** Best use of Arc
- **Bounties:** Gemini Prediction Markets · Grok Bot

## Links

- **GitHub (public):** **TODO** `https://github.com/penumbraaasol/backstop`
- **Live app:** **TODO** Vercel URL
- **Demo video (YouTube or Google Drive, 2–3 min, viewable by anyone with the link):** **TODO**
- **Backstop contract (Arc testnet, verified):** https://explorer.testnet.arc.io/address/0x3c7cdb6658BbcE924dCBD6327FCc5B72B3624A05

---

## What did you build?

Backstop is parametric event cover on Arc. You pick a real-world outcome you want protection against, such as "BTC finishes below $63,100 at 19:00 UTC", "Gold closes under $3,750", "Austin tops 73°F" or a game result, and a payout N in USDC. Backstop quotes a premium from Gemini's live prediction-market odds, you buy the policy onchain in one click, and the backend immediately buys N matching contracts on Gemini as the hedge. When Gemini resolves the market, the result is posted onchain and the smart contract pays you N USDC if your outcome happened.

On top sits a **Grok agent with its own wallet**. You can chat with it ("protect my ETH against a drop in the next hour"), or let it run on autopilot: it screens every live market and the chain every 30 seconds, values a portfolio at Gemini spot, and buys or holds cover with a short, numbers-based reason for every decision. Its purchases are real Arc transactions with no human signature, inside limits the server enforces.

It is a working end-to-end system: a verified Solidity contract on Arc testnet, a Node backend (quote signer, Gemini hedger, resolver, indexer, Grok agent), and a Next.js app with live markets, a receipt-style premium breakdown, policy tracking, and the agent's chat, jobs and activity feed.

## What problem does it solve?

Hedging a specific event is hard. Prediction markets price real-world events well, but using one as a hedge means opening an exchange account, understanding contract mechanics, sizing positions, and holding the position offchain, where no wallet, DAO or smart contract can see or use it. Traditional parametric insurance has the opposite problem: the product is simple, but it needs an underwriting pool and actuarial pricing, which makes small, short-dated cover uneconomic.

Backstop packages a prediction-market position as a simple insurance product, "pay 0.64 USDC now, get 2 USDC if BTC is below $63,082 at 10:45", settled in USDC onchain. Anyone (or any agent or contract) can buy it in a single transaction, and the Grok agent can manage that protection continuously for a portfolio.

## How does it work?

1. **Price.** The backend reads Gemini's best ask p for the chosen outcome and quotes premium = N × (p + s), where s is a 3¢ spread that covers Gemini's taker fee and the margin. The quote is EIP-712 signed, bound to the buyer, single-use and valid for 60 s. A quote is refused if the hedge venue can't fill near that price ("only sell cover you can hedge").
2. **Buy.** The buyer approves USDC and calls `buyPolicy`. The contract verifies the signature, caps and liquidity, pulls the premium and **locks the full payout** from its USDC treasury.
3. **Hedge.** The backend indexes `PolicyPurchased` and places a fill-or-kill limit order for N contracts on Gemini (sandbox in this demo), priced at most p + 2¢. If it doesn't fill, the backend calls `cancelAndRefund` and the buyer gets the premium back automatically.
4. **Resolve.** After expiry the backend reads Gemini's `resolutionSide`, calls `resolveMarket` once per market and `settle` for each policy. Winning policies are paid N USDC; locked liquidity is released either way.
5. **Grok agent.** The agent has its own Arc wallet. Its decision loop: the screener reads ~170 live Gemini markets every 30 s and flags price moves, cheap cover and new windows → for each relevant finding (and every 5 min) the server builds candidate hedges for the agent's portfolio (0.01 BTC, 0.3 ETH at Gemini spot) with the numbers that matter (strike vs spot, cost per $1, implied odds, a size matched to a 1% loss) and keeps only sound ones → Grok picks one or holds, citing those numbers → the server re-checks the pick and buys through the same contract path. Safety limits: max 10 USDC payout per policy, 25 USDC of premiums per day, downside cover only, strike −1.5% to +0.3% of spot, cost 0.12–0.60 per $1, one policy per asset, a 2¢ price ceiling between decision and purchase, a balance check, an on/off switch, and a guard that disables buying when the user says not to buy.
6. **Safety valves.** If the backend disappears, buyers can call `claimRefund` 24 h after the deadline. The owner can only withdraw unlocked liquidity, and per-policy and per-market caps bound the exposure.

Every path (payout, expiry, refund, autopilot purchase with a filled Gemini hedge, chat purchase) has run on Arc testnet; transactions are linked in the README.

## What makes it unique?

- **A new primitive: insurance with no underwriting pool.** Each policy is backed one-for-one by an offsetting prediction-market position. The prediction market is both the **price oracle** and the **reinsurer**: no actuarial model, no LP pool taking directional risk; the protocol earns only the spread.
- **Composes with an existing venue instead of rebuilding one.** Backstop routes risk to Gemini's markets, with their liquidity and official resolution, across crypto, commodities, weather and sports.
- **An AI hedger that is financially disciplined.** Grok doesn't pick contracts at random: it hedges a valued portfolio, sizes to the exposure, and every pick is checked server-side against explicit risk rules before any money moves.
- **Safe by construction.** Premiums are always below payout, payouts are locked at purchase, unhedgeable cover is never sold, failed hedges refund automatically, and buyers have an escape hatch if the operator disappears.
- **Built for Arc.** USDC is the gas token and the settlement asset, so everything is denominated in dollars. That's what makes 2-USDC, 15-minute cover practical, for people and for agents.

## What would you build next?

- **Trust-minimised resolution:** multiple quote signers and resolvers, or a zkTLS proof of Gemini's resolution response, so the contract doesn't trust a single relayer.
- **Composable cover:** an ERC-721/1155 policy token other protocols can hold, transfer or use as collateral, e.g. a lending protocol buying event cover for its depositors.
- **Cross-chain buyers with CCTP:** pay the premium from any chain, receive the payout on Arc or back home.
- **Agent wallets and payments:** move the Grok agent onto Circle Wallets and let other agents buy cover from Backstop per request (x402).
- **Live mode at scale:** production Gemini orders, depth-aware quotes for larger sizes, and automated treasury rebalancing between Gemini settlements (USD) and the onchain USDC float.

## Technologies and sponsor tools used

- **Arc (Circle):** Arc testnet, USDC as gas and settlement asset, official USDC ERC-20 `0x3600…0000`, Arc block explorer (Blockscout) for contract verification
- **Gemini Prediction Markets API:** market data (events, contracts, best asks, resolution), trading API on the sandbox (`@gemini-markets/sdk`: orders, cancels, positions, terms), and the Gemini public ticker for spot prices
- **Grok (xAI API):** `grok-4.20` with structured outputs and tool calling, for the chat agent and the autopilot
- **Smart contracts:** Solidity 0.8.24, Foundry (forge, cast), OpenZeppelin 5.1 (EIP-712, ECDSA, SafeERC20, ReentrancyGuard, Ownable)
- **Backend:** Node 24, TypeScript, Fastify, viem, zod, SQLite (`node:sqlite`)
- **Frontend:** Next.js 16, React 19, wagmi 3, viem, TanStack Query, Tailwind CSS 4
- **Hosting:** Vercel (web), Railway (backend)

---

## Track-specific requirements (checklist)

**DeFi and Onchain Applications**
- [x] Interacts with smart contracts on Arc testnet (own contract `Backstop.sol` + USDC)
- [x] Economic design and risk assumptions in the README ("Economic design", "Risk assumptions")
- [x] Address of every contract deployed or used (README "Deployed contracts")

**Best use of Arc**
- [x] Core onchain functionality on Arc (testnet)
- [x] Contract addresses and an explanation of how Backstop uses Arc (README "How Backstop uses Arc")

**Gemini Prediction Markets**
- [x] Uses the Gemini Prediction Markets API: market data for pricing and resolution, trading endpoints for hedging (README "Gemini integration notes")

**Grok Bot**
- [x] Grok is a core part of the project: the agent chat and the autopilot that buys cover (README "Grok's role")
- [x] Short README section (3–4 sentences) on Grok's role
- [x] Chat export: [`docs/grok-agent-chat-export.md`](docs/grok-agent-chat-export.md) (in-app Grok agent)
- [ ] **TODO:** export of the Grok chat on X/grok.com used while building (Grok suggested the event-hedge idea) → save as `docs/grok-bot-chat-export.md` (or a share link)
