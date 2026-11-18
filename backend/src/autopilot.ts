// Grok autopilot: the screener's findings go to Grok together with a standing mandate, the live
// markets and the agent's own positions on Arc. Grok answers buy or hold with a short reason.
// Buys go through buyCover() (same caps and budget as everything else). Every decision is logged.
import { agentAddress, agentBalance, agentEnabled, buyCover, dailyBudget, logEvent, spentToday } from "./agent.js";
import { cfg } from "./config.js";
import { db, kvGet, kvSet, now } from "./db.js";
import type { MarketView } from "./markets.js";
import { formatUsdc } from "./quotes.js";

export type Finding = {
  kind: "move" | "cheap" | "opened";
  market: MarketView;
  side?: "yes" | "no";
  prev?: number;
  now?: number;
  text: string;
};

const DEFAULT_MANDATE =
  "I hold BTC and ETH. Keep a few USDC of downside cover on the upcoming 15-minute windows whenever cover is fairly priced (ask at or below 0.55). Don't chase expensive cover, and don't stack cover on the same window.";

export function autopilotState() {
  return {
    enabled: (kvGet("autopilot:enabled") ?? (cfg.AUTOPILOT_DEFAULT_ON ? "1" : "0")) === "1",
    mandate: kvGet("autopilot:mandate") ?? DEFAULT_MANDATE,
    lastDecisionAt: Number(kvGet("autopilot:lastDecisionAt") ?? 0) || null,
    lastReviewAt: Number(kvGet("autopilot:lastReviewAt") ?? 0) || null,
    reviewEverySec: REVIEW_EVERY_SEC,
    model: cfg.GROK_MODEL,
  };
}

export function setAutopilot(p: { enabled?: boolean; mandate?: string }) {
  if (p.enabled !== undefined) {
    kvSet("autopilot:enabled", p.enabled ? "1" : "0");
    logEvent("watch", `Grok autopilot switched ${p.enabled ? "on" : "off"}`);
  }
  if (p.mandate !== undefined) {
    const m = p.mandate.trim().slice(0, 400);
    kvSet("autopilot:mandate", m);
    logEvent("watch", "Autopilot mandate updated", { detail: m });
  }
  return autopilotState();
}

const MIN_GAP_SEC = 45; // at most one decision per 45 s
const REVIEW_EVERY_SEC = 300; // and a review every 5 min even without findings

const assetOf = (m: MarketView) => m.asset ?? "";
/** "at or above $X" and "up from open" markets: a price direction, so downside and upside cover are fixed sides. */
const directional = (m: MarketView) => !!m.strike || /^up$/i.test(m.label);
const fmtMarket = (m: MarketView) =>
  `${m.instrumentSymbol} | ${m.question} | closes in ${Math.round(m.secondsToExpiry / 60)} min | YES ${m.askYes.toFixed(2)} | NO ${m.askNo.toFixed(2)}` +
  (directional(m) ? ` | downside cover = NO (pays if it ends below), upside cover = YES` : "");

function heldSymbols(): Set<string> {
  if (!agentAddress) return new Set();
  const rows = db
    .prepare("SELECT instrument_symbol FROM policies WHERE buyer = ? AND status = 'active'")
    .all(agentAddress.toLowerCase()) as { instrument_symbol: string }[];
  return new Set(rows.map((r) => r.instrument_symbol));
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    action: { type: "string", enum: ["buy", "hold"] },
    protects: { type: "string", enum: ["downside", "upside", "event"], description: "Which risk the purchase covers: a price drop, a price rise, or a non-price event" },
    instrumentSymbol: { type: ["string", "null"] },
    outcome: { type: ["string", "null"], enum: ["yes", "no", null] },
    payout: { type: ["integer", "null"] },
    headline: { type: "string", description: "Under 12 words, e.g. 'BTC downside got cheaper, covering the 9:15 window'" },
    reasoning: { type: "string", description: "At most two short sentences, with the concrete numbers that drove the decision" },
  },
  required: ["action", "protects", "instrumentSymbol", "outcome", "payout", "headline", "reasoning"],
} as const;

type Decision = { action: "buy" | "hold"; protects: "downside" | "upside" | "event"; instrumentSymbol: string | null; outcome: "yes" | "no" | null; payout: number | null; headline: string; reasoning: string };

async function decide(mandate: string, findings: Finding[], candidates: MarketView[], held: Set<string>): Promise<Decision> {
  const balance = await agentBalance();
  const spent = spentToday();
  const budget = dailyBudget();
  const system = [
    "You are Grok, the autopilot of Backstop's hedging agent. You manage a testnet wallet on Arc that buys parametric cover: a policy pays N USDC if an outcome of a Gemini prediction market happens; premium = N × (ask + 0.03).",
    "Decide whether to act on the screener's findings under the user's mandate. Answer 'buy' with one market, or 'hold'.",
    "Hedging logic: holding an asset means its DOWNSIDE is the risk: cover it with NO on an 'at or above' / 'up' market (NO pays if the price ends below). Short or waiting to buy means the UPSIDE is the risk: cover with YES. Each candidate line states which side is which; use it.",
    "Cheapness alone is never a reason: a cheap contract on the wrong side doesn't hedge anything. Set `protects` to the risk you are covering.",
    "Only buy when it clearly serves the mandate and the price is reasonable. Never buy a market listed as already held. Prefer windows with more than 3 minutes left.",
    `Payout is a whole number from 1 to ${cfg.AGENT_MAX_PAYOUT} USDC. Remaining budget today: ${formatUsdc(budget - spent)} USDC; wallet: ${formatUsdc(balance)} USDC.`,
    "Holding is a fine answer. Keep the reasoning short, concrete and dry: cite the price, the move and the window. No emojis, no hype.",
  ].join("\n");
  const user = [
    `Mandate: ${mandate}`,
    `Time: ${new Date().toISOString()}`,
    `Findings this cycle:\n${findings.length ? findings.map((f) => `- ${f.text}`).join("\n") : "- none (periodic review)"}`,
    `Already held (active policies): ${held.size ? [...held].join(", ") : "none"}`,
    `Candidate markets (symbol | question | time left | asks):\n${candidates.map(fmtMarket).join("\n")}`,
  ].join("\n\n");

  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.GROK_API_KEY}` },
    signal: AbortSignal.timeout(25_000),
    body: JSON.stringify({
      model: cfg.GROK_MODEL,
      temperature: 0.2,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_schema", json_schema: { name: "autopilot_decision", strict: true, schema: SCHEMA } },
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { choices?: { message?: { content?: string } }[] };
  if (!res.ok) throw new Error(`Grok request failed (HTTP ${res.status})`);
  return JSON.parse(body.choices?.[0]?.message?.content ?? "") as Decision;
}

let running = false;

/** Called by the job loop after each screener pass. */
export async function runAutopilot(findings: Finding[], markets: MarketView[]) {
  const st = autopilotState();
  if (!st.enabled || !agentEnabled() || running) return;
  const t = now();
  const sinceDecision = t - (st.lastDecisionAt ?? 0);
  const sinceReview = t - (st.lastReviewAt ?? 0);
  const due = findings.length > 0 ? sinceDecision >= MIN_GAP_SEC : sinceReview >= REVIEW_EVERY_SEC;
  if (!due) return;

  running = true;
  try {
    kvSet("autopilot:lastDecisionAt", String(t));
    kvSet("autopilot:lastReviewAt", String(t));
    const held = heldSymbols();
    // what Grok may choose from: markets in the findings, plus short-dated crypto and commodities, open long enough to hedge
    const open = markets.filter((m) => m.secondsToExpiry > 120 && Math.min(m.askYes, m.askNo) < 0.97);
    const pool = new Map<string, MarketView>();
    for (const f of findings) if (open.includes(f.market)) pool.set(f.market.instrumentSymbol, f.market);
    for (const m of open.filter((m) => m.category === "crypto" && (m.kind === "15m" || /1H$/.test(m.series ?? ""))).slice(0, 24))
      pool.set(m.instrumentSymbol, m);
    for (const m of open.filter((m) => m.category === "commodities").slice(0, 8)) pool.set(m.instrumentSymbol, m);
    const candidates = [...pool.values()].slice(0, 40);
    if (!candidates.length) return;

    const d = await decide(st.mandate, findings.slice(0, 8), candidates, held);
    const market = d.instrumentSymbol ? pool.get(d.instrumentSymbol) : undefined;
    const reviewed = findings.length ? `${findings.length} finding${findings.length > 1 ? "s" : ""}` : "periodic review";

    if (d.action !== "buy" || !market || !d.outcome) {
      logEvent("decision", `Hold · ${d.headline}`, { detail: `${d.reasoning} (${reviewed})` });
      return;
    }
    // the hedge must point the right way: downside cover is NO, upside cover is YES
    if (directional(market) && d.protects !== "event") {
      const want = d.protects === "downside" ? "no" : "yes";
      if (d.outcome !== want) {
        logEvent("decision", "Hold · pick rejected: wrong side", {
          detail: `Grok proposed ${d.outcome.toUpperCase()} as ${d.protects} cover, but on this market ${d.protects} cover is ${want.toUpperCase()}. Nothing bought.`,
          symbol: market.instrumentSymbol,
        });
        return;
      }
    }
    if (held.has(market.instrumentSymbol)) {
      logEvent("decision", `Hold · already covered on this window`, { detail: d.reasoning, symbol: market.instrumentSymbol });
      return;
    }
    logEvent("decision", `Buy · ${d.headline}`, { detail: `${d.reasoning} (${reviewed})`, symbol: market.instrumentSymbol });
    await buyCover(
      { market, outcome: d.outcome, payout: d.payout ?? 1, maxAsk: d.outcome === "yes" ? market.askYes : market.askNo },
      { instruction: `Autopilot: ${st.mandate}`, summary: d.headline, reasoning: d.reasoning, source: "autopilot" },
    );
  } catch (e) {
    logEvent("error", "Autopilot decision failed", { detail: (e as Error).message.split("\n")[0] });
  } finally {
    running = false;
  }
}

export { assetOf };
