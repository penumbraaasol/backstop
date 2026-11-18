# Backstop demo script (2–3 minutes)

The goal is to show one real policy going end to end: **live Gemini price → onchain purchase on Arc → real Gemini hedge order → Gemini resolution → onchain payout**. Use a short-expiry BTC market so it settles while you record.

## Before you record (10 minutes)

1. **Backend up, in sandbox mode.** `curl <backend>/health` returns `{"ok":true,"hedgeMode":"sandbox"}`. Only one backend should be running with workers.
2. **Wallet ready.** MetaMask or Rabby on Arc Testnet, with at least 3 USDC from https://faucet.circle.com. Use a fresh browser profile with no other extensions popping up.
3. **Treasury has room.** The hero shows "Treasury available" ≥ the payout you'll buy.
4. **Pick a market whose sandbox book can fill.** Gemini's sandbox has its own order books, separate from production. If the sandbox ask is above the production ask + 0.02, the fill-or-kill hedge won't fill and the policy is refunded. That's a valid demo of the refund path, but not the one you want first. Check the next BTC 5-minute or 15-minute market:
   ```bash
   # production ask (what the app quotes)
   curl -s "https://api.gemini.com/v1/prediction-markets/events?status=active&category=crypto&limit=100" | jq '.data[] | select(.ticker|startswith("BTC05M")) | {ticker, c: [.contracts[] | {s: .instrumentSymbol, yes: .prices.buy.yes, no: .prices.buy.no}]}' | head -40
   # sandbox ask (where the hedge is placed)
   curl -s "https://api.sandbox.gemini.com/v1/prediction-markets/events?status=active&category=crypto&limit=100" | jq '.data[] | select(.ticker|startswith("BTC05M")) | {ticker, c: [.contracts[] | {s: .instrumentSymbol, yes: .prices.buy.yes, no: .prices.buy.no}]}' | head -40
   ```
   Choose a symbol and side where sandbox ≤ production + 0.02.
5. **Timing.** Start recording when the chosen market has **3–4 minutes** left. That leaves time to buy (needs > 45 s left) and to see settlement about 15 s after expiry.
6. Open two tabs: the app, and the Arc explorer page for the Backstop contract.

## Script

| Time | Screen | Say |
|---|---|---|
| 0:00–0:15 | Hero | "This is Backstop: parametric event cover on Arc. You pay a USDC premium; if the event happens, the contract pays you. The price comes from Gemini's prediction market, and every policy is hedged on Gemini." |
| 0:15–0:35 | Get cover → **5 min** tab → BTC row | "These are live Gemini markets refreshing every 5 seconds. Say I'm long BTC and want protection if it dips in the next few minutes. I'll cover **NO**, BTC below the strike." Click the NO price. |
| 0:35–0:55 | Ticket: set payout $2, open "How this price is set" | "Two dollars of cover. The premium is N × (p + s): two times Gemini's ask plus a 3-cent spread. The hedge costs N × p on Gemini; the spread is our margin and covers Gemini's fees." |
| 0:55–1:15 | Click **Buy cover**, approve and confirm in the wallet | "One click: the backend signs an EIP-712 quote valid for 60 seconds, I approve USDC and buy. Gas is paid in USDC too, so I only ever hold dollars." |
| 1:15–1:35 | Success panel → **Track policy** → My cover timeline | "The policy is onchain, and its full payout is locked in the contract. The backend saw the event and placed a real order on Gemini. Here's the fill and price." Point at "Hedged on Gemini · 2 NO @ 0.xx". |
| 1:35–1:50 | Explorer tab: buy tx, PolicyPurchased event | "Everything is verifiable on Arc: the purchase, the locked payout, the signer." |
| 1:50–2:30 | Back on My cover, wait for expiry (or cut ahead) | "When the window closes, the backend reads Gemini's official result and posts it onchain. The contract pays out automatically." Show "Resolved" then "Paid out" or "Expired" with tx links. |
| 2:30–2:50 | How it works → protections card | "If the hedge can't fill, the premium is refunded automatically. If our backend goes down, buyers can reclaim their premium themselves after a grace period. The operator can never withdraw funds locked for open policies." |
| 2:50–3:00 | Hero | "Backstop: the prediction market is both the oracle and the reinsurer. A new DeFi primitive for hedging real-world events." |

## If something goes wrong on camera

- **The hedge doesn't fill → "Refunded".** Keep going: "This is the safety path. The order didn't fill, so the contract refunded my premium automatically." Then show the refund tx.
- **The market is too close to expiry ("Market closing").** Switch to the next window, or use the 15-minute tab.
- **Settlement takes longer than the video allows.** Cut to the explorer page for policy #3's payout (a real sandbox fill that paid out; the tx link is in the README). It was bought from the deployer wallet, so it won't appear under your browser wallet's My cover.

## Backup: CLI run (no browser wallet)

```bash
cd backend
corepack pnpm e2e --outcome auto --payout 2      # quote → buy → hedge → resolve → payout, all logged with explorer links
```
