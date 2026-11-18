# Submission answers (draft)

Track: **DeFi and Onchain Applications** · Chain award: **Best use of Arc** · Bounty: **Gemini Prediction Markets**

## What did you build?

Backstop is parametric event cover on Arc. You choose a real-world outcome you want protection against, such as "BTC finishes below $64,900 at 05:30 UTC", and a payout N in USDC. Backstop quotes a premium from Gemini's live prediction-market odds, and you buy the policy onchain in one click. The backend then buys N matching contracts on Gemini as the hedge. When Gemini resolves the market, the result is posted onchain and the smart contract pays you N USDC if your outcome happened.

It's a working end-to-end system:
- A verified Solidity contract on Arc testnet.
- A Node backend that signs EIP-712 quotes, places real orders through Gemini's trading API (sandbox) and resolves markets from Gemini's official results.
- A Next.js app with live markets, a premium breakdown, and a policy timeline linked to every onchain transaction.

## What problem does it solve?

Hedging a specific event is hard for ordinary users and for onchain protocols. Prediction markets price these events well, but using one as a hedge means opening an exchange account, understanding contract mechanics, sizing positions, and holding the position offchain where no smart contract can see or use it. Traditional parametric insurance has the opposite problem: the product is simple, but it needs an underwriting pool and actuarial pricing, which makes small, short-dated cover uneconomic.

Backstop packages a prediction-market position as a simple insurance product: "pay $1.26 now, get $2 if this happens", settled in USDC onchain. Wallets, DAOs and other contracts can buy it in a single transaction.

## How does it work?

1. **Price.** The backend reads Gemini's best ask p for the chosen outcome and quotes premium = N × (p + s), where s is a 3¢ spread that covers Gemini's taker fee and the margin. The quote is EIP-712 signed, bound to the buyer, single-use and valid for 60 s.
2. **Buy.** The buyer approves USDC and calls `buyPolicy`. The contract verifies the signature, caps and liquidity, pulls the premium, and **locks the full payout** from its USDC treasury.
3. **Hedge.** The backend indexes `PolicyPurchased` and places a fill-or-kill limit order for N contracts on Gemini, priced at most p + 2¢. If the order doesn't fill, it calls `cancelAndRefund` and the buyer gets the premium back.
4. **Resolve.** After expiry, the backend reads Gemini's `resolutionSide` and calls `resolveMarket` once per market, then `settle` for each policy. The contract pays N USDC to winning policies and releases the locked liquidity.
5. **Safety valves.** If the backend disappears, buyers can call `claimRefund` 24 h after the deadline. The owner can only withdraw unlocked liquidity, and per-policy and per-market caps bound the exposure.

An optional **cover assistant** powered by Grok turns a plain-English worry ("I hold BTC and I'm worried it drops in the next hour") into a filled-in policy: the right market, the side that offsets the risk, and a size. In "suggest" mode it only fills in the ticket and the buyer signs. In **agent** mode, Grok acts on its own: the backend buys the policy on Arc from the agent's own testnet wallet with no human signature, inside hard limits (a per-policy payout cap, a daily spending budget, a balance check and an on/off switch). Every decision is logged with Grok's reasoning and the transaction, and the policy is hedged and settled like any other.

Every path (payout, expiry, refund) has run on Arc testnet, including a real Gemini sandbox fill that paid out and a real unfilled order that was refunded.

## What makes it unique?

- **A new primitive: insurance with no underwriting pool.** Each policy is backed one-for-one by an offsetting prediction-market position. The prediction market is both the **price oracle** and the **reinsurer**, so there's no actuarial model, no LP pool taking directional risk, and the protocol earns only the spread.
- **It composes with an existing venue instead of rebuilding one.** Backstop doesn't build its own prediction market or order book. It routes risk to Gemini's existing market, with its liquidity and official resolution.
- **Capital efficient and safe by construction.** Premiums are always below payout, payouts are locked at purchase, and failed hedges refund automatically. The only trusted role is bounded by signatures, single-use nonces, short expiries, caps and a buyer-side escape hatch.
- **Built for Arc.** USDC is the gas token and the settlement asset, so the whole experience is denominated in dollars. That's what makes $2, 5-minute cover practical.

## What would you build next?

- **More real-world categories:** weather, macro releases (CPI, rate decisions) and sports, for farmers, businesses and treasuries that want parametric protection against those events.
- **Trust-minimised resolution:** multiple quote signers and resolvers, or a zkTLS proof of Gemini's resolution response, so the contract doesn't have to trust a single relayer.
- **Composable cover:** an ERC-721 or ERC-1155 policy token that other protocols can hold, transfer or use as collateral. For example, a lending protocol could buy event cover for its depositors.
- **Cross-chain buyers with CCTP:** pay the premium from any chain and receive the payout on Arc or back on the home chain.
- **Automated treasury rebalancing:** sweep Gemini settlements (USD) back into the onchain USDC float through Circle, and size the treasury from open exposure.
- **Live mode at scale:** production Gemini orders with risk limits per market, and quotes for larger sizes that account for order-book depth and slippage.
