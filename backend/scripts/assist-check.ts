// Checks the cover assistant (Grok) against sample markets, so it can be tested even when Gemini is down.
// Usage: pnpm --filter @backstop/backend assist:check
import { askGrok } from "../src/assist.js";

const lines = [
  "GEMI-BTC15M2611180330-HI64300 | BTC is at or above $64,300 at 03:30 UTC | closes in 12 min | YES ask 0.55 | NO ask 0.47",
  "GEMI-ETH15M2611180330-HI1800 | ETH is at or above $1,800 at 03:30 UTC | closes in 12 min | YES ask 0.48 | NO ask 0.55",
  "GEMI-BTC1H2611180400-HI64000 | BTC is at or above $64,000 at 04:00 UTC | closes in 42 min | YES ask 0.66 | NO ask 0.36",
  "GEMI-SOL15M2611180330-HI74 | SOL is at or above $74 at 03:30 UTC | closes in 12 min | YES ask 0.52 | NO ask 0.50",
].join("\n");

const cases = [
  "I hold 0.2 BTC and I'm worried it drops in the next hour. Protect me with about 3 dollars.",
  "I'm about to buy ETH, scared it pumps before I get in",
  "what's the weather tomorrow",
];
for (const msg of cases) {
  const t = Date.now();
  const r = await askGrok(msg, lines, 5);
  console.log(`\n> ${msg}  (${Date.now() - t} ms)\n`, r);
}
