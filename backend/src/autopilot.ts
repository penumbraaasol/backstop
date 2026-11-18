// Grok autopilot: a portfolio-aware hedger.
//
// The agent holds a hypothetical portfolio (e.g. 0.01 BTC, 0.3 ETH) valued at Gemini spot. On each
// screener finding (and every 5 min) the server builds the candidate hedges for that portfolio,
// computes the numbers that matter (strike vs spot, cost per $1 of cover, implied odds, a size
// matched to the exposure) and keeps only the ones that pass sound-hedge rules. Grok picks one or
// holds, citing those numbers. The server re-checks the pick before buyCover() spends anything.
import { agentAddress, agentBalance, agentEnabled, buyCover, dailyBudget, logEvent, spentToday } from "./agent.js";
import { cfg } from "./config.js";
import { db, kvGet, kvSet, now } from "./db.js";
import { getSpot, venueCanHedge } from "./gemini/public.js";
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

export type Holding = { asset: string; amount: number };

// --- policy: what counts as a sound hedge --------------------------------------------------------
const RULES = {
  /** strike relative to spot: from 1.5% below (protection against a real drop) to 0.3% above (at the money) */
  minDistance: -0.015,
  maxDistance: 0.003,
  /** cost per $1 of cover (ask + spread): cheaper is a lottery ticket, dearer means the drop is already priced in */
  minCost: 0.12,
  maxCost: 0.6,
  /** size: payout ≈ the loss on the holding from a 1% fall, never more than 1.5× that */
  hedgeMove: 0.01,
  maxSizeMultiple: 1.5,
  /** never hedge a window that closes in under 3 minutes (the Gemini hedge needs time to fill) */
  minSecondsLeft: 180,
};

const DEFAULT_HOLDINGS: Holding[] = [
  { asset: "BTC", amount: 0.01 },
  { asset: "ETH", amount: 0.3 },
];
const DEFAULT_MANDATE =
  "Protect my BTC and ETH against short-term drops. Hedge about a 1% move on each holding, with strikes near the current price, and don't overpay for cover.";

const MIN_GAP_SEC = 45; // at most one decision per 45 s
const REVIEW_EVERY_SEC = 300; // and a review every 5 min even without findings

function holdings(): Holding[] {
  try {
    const h = JSON.parse(kvGet("autopilot:holdings") ?? "") as Holding[];
    if (Array.isArray(h) && h.length) return h;
  } catch {
    /* default */
  }
  return DEFAULT_HOLDINGS;
}

// last valuation, so the UI can show it without waiting for the next run
let lastValuation: { asset: string; amount: number; spot: number | null; valueUsd: number | null }[] = [];

export function autopilotState() {
  return {
    enabled: (kvGet("autopilot:enabled") ?? (cfg.AUTOPILOT_DEFAULT_ON ? "1" : "0")) === "1",
    mandate: kvGet("autopilot:mandate") ?? DEFAULT_MANDATE,
    holdings: lastValuation.length ? lastValuation : holdings().map((h) => ({ ...h, spot: null, valueUsd: null })),
    rules: RULES,
    lastDecisionAt: Number(kvGet("autopilot:lastDecisionAt") ?? 0) || null,
    lastReviewAt: Number(kvGet("autopilot:lastReviewAt") ?? 0) || null,
    reviewEverySec: REVIEW_EVERY_SEC,
    model: cfg.GROK_MODEL,
  };
}

export function setAutopilot(p: { enabled?: boolean; mandate?: string; holdings?: Holding[] }) {
  if (p.enabled !== undefined) {
    kvSet("autopilot:enabled", p.enabled ? "1" : "0");
    logEvent("watch", `Grok autopilot switched ${p.enabled ? "on" : "off"}`);
  }
  if (p.mandate !== undefined) {
    const m = p.mandate.trim().slice(0, 400);
    kvSet("autopilot:mandate", m);
    logEvent("watch", "Autopilot mandate updated", { detail: m });
  }
  if (p.holdings !== undefined) {
    const h = p.holdings
      .map((x) => ({ asset: x.asset.toUpperCase().trim(), amount: Number(x.amount) }))
      .filter((x) => /^[A-Z]{2,6}$/.test(x.asset) && x.amount > 0)
      .slice(0, 4);
    if (h.length) {
      kvSet("autopilot:holdings", JSON.stringify(h));
      lastValuation = [];
      logEvent("watch", "Autopilot holdings updated", { detail: h.map((x) => `${x.amount} ${x.asset}`).join(", ") });
    }
  }
  return autopilotState();
}

// --- candidates ------------------------------------------------------------------------------------
type Candidate = {
  market: MarketView;
  asset: string;
  spot: number;
  strike: number;
  distance: number; // (strike - spot) / spot
  ask: number; // NO ask: downside cover
  cost: number; // per $1 of cover: ask + spread
  impliedDrop: number; // ≈ NO ask: the market's odds that it ends below the strike
  suggestedPayout: number;
  maxPayout: number;
  holdingValue: number;
  pass: boolean;
  why: string; // reason it fails a rule, or "ok"
};

const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(2)}%`;

function activePolicyAssets(): Set<string> {
  if (!agentAddress) return new Set();
  const rows = db
    .prepare("SELECT instrument_symbol FROM policies WHERE buyer = ? AND status = 'active'")
    .all(agentAddress.toLowerCase()) as { instrument_symbol: string }[];
  return new Set(rows.map((r) => r.instrument_symbol.slice(5).match(/^[A-Z]+?(?=05M|15M|1H|\d)/)?.[0] ?? ""));
}

async function buildCandidates(markets: MarketView[]) {
  const book = holdings();
  const valuation: typeof lastValuation = [];
  const out: Candidate[] = [];
  for (const h of book) {
    const spot = await getSpot(h.asset);
    valuation.push({ ...h, spot: spot ?? null, valueUsd: spot ? spot * h.amount : null });
    if (!spot) continue;
    const value = spot * h.amount;
    const suggested = Math.max(1, Math.min(cfg.AGENT_MAX_PAYOUT, Math.round(value * RULES.hedgeMove)));
    const maxPayout = Math.min(cfg.AGENT_MAX_PAYOUT, Math.max(1, Math.round(suggested * RULES.maxSizeMultiple)));
    for (const m of markets) {
      if (m.category !== "crypto" || m.asset !== h.asset || !m.strike) continue; // a directional market with a known strike
      if (m.secondsToExpiry < RULES.minSecondsLeft) continue;
      const strike = Number(m.strike);
      const distance = (strike - spot) / spot;
      const ask = m.askNo;
      const cost = ask + cfg.SPREAD;
      const why =
        distance < RULES.minDistance
          ? `strike ${pct(distance)} from spot: too far below to protect anything`
          : distance > RULES.maxDistance
            ? `strike ${pct(distance)} above spot: already in the money, pays for a drop that hasn't happened`
            : cost < RULES.minCost
              ? `costs ${cost.toFixed(2)} per $1: a lottery ticket, not a hedge`
              : cost > RULES.maxCost
                ? `costs ${cost.toFixed(2)} per $1: the drop is already priced in`
                : "ok";
      out.push({
        market: m,
        asset: h.asset,
        spot,
        strike,
        distance,
        ask,
        cost,
        impliedDrop: ask,
        suggestedPayout: suggested,
        maxPayout,
        holdingValue: value,
        pass: why === "ok",
        why,
      });
    }
  }
  lastValuation = valuation;
  // only cover we can hedge: check the venue's ask for the candidates that pass everything else
  for (const c of out.filter((x) => x.pass)) {
    const v = await venueCanHedge(c.market.instrumentSymbol, "no", c.ask, c.market.eventTicker).catch(() => ({ ok: false, ask: undefined }));
    if (!v.ok) {
      c.pass = false;
      c.why = `can't be hedged: Gemini ${cfg.HEDGE_MODE} book asks ${v.ask?.toFixed(2) ?? "nothing"} vs ${c.ask.toFixed(2)}`;
    }
  }
  return out.sort((a, b) => a.market.secondsToExpiry - b.market.secondsToExpiry);
}

const fmtCandidate = (c: Candidate) =>
  `${c.market.instrumentSymbol} | ${c.market.question} | closes in ${Math.round(c.market.secondsToExpiry / 60)} min | ` +
  `spot $${c.spot.toLocaleString("en-US", { maximumFractionDigits: 2 })}, strike ${pct(c.distance)} | ` +
  `NO (downside cover) ask ${c.ask.toFixed(2)} → cost ${c.cost.toFixed(2)} per $1, market odds of a drop below strike ~${Math.round(c.impliedDrop * 100)}% | ` +
  `suggested payout ${c.suggestedPayout} USDC (premium ≈ ${(c.suggestedPayout * c.cost).toFixed(2)}), max ${c.maxPayout}`;

// --- Grok ------------------------------------------------------------------------------------------
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    action: { type: "string", enum: ["buy", "hold"] },
    instrumentSymbol: { type: ["string", "null"] },
    payout: { type: ["integer", "null"] },
    headline: { type: "string", description: "Under 12 words, e.g. 'Hedging 1% BTC drop for the 9:15 window'" },
    reasoning: {
      type: "string",
      description: "Two short sentences citing: holding value, strike vs spot, cost per $1, and the loss the payout offsets (or why holding is better)",
    },
  },
  required: ["action", "instrumentSymbol", "payout", "headline", "reasoning"],
} as const;

type Decision = { action: "buy" | "hold"; instrumentSymbol: string | null; payout: number | null; headline: string; reasoning: string };

async function decide(mandate: string, findings: Finding[], passing: Candidate[], rejected: Candidate[], covered: Set<string>) {
  const balance = await agentBalance();
  const left = dailyBudget() - spentToday();
  const book = lastValuation
    .map((h) => `${h.amount} ${h.asset}${h.valueUsd ? ` ≈ $${Math.round(h.valueUsd).toLocaleString("en-US")} at $${h.spot!.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : ""}`)
    .join("; ");
  const system = [
    "You are Grok, running a hedging desk inside Backstop. You protect a portfolio against short-term price drops by buying parametric cover on Arc: a policy pays N USDC if the asset ends below a strike; premium = N × cost per $1.",
    "Make a financially sound call, like a risk manager, not a gambler:",
    "- Hedge the holdings that are uncovered. Never add a second policy on an asset that is already covered.",
    "- Prefer strikes just below spot (they pay on a real drop) over ones at or above spot (expensive) or far below (protect little).",
    "- Compare cost per $1 with the market's odds: paying 0.45 for a ~42% event is fair; paying 0.58 when the window closes in 4 min is not.",
    "- Size to the exposure: use the suggested payout (≈ loss from a 1% fall). Go up to the max only if you explain why.",
    "- Holding is the right answer when nothing is fairly priced or everything is covered.",
    `Budget left today: ${formatUsdc(left)} USDC; wallet ${formatUsdc(balance)} USDC. Only the listed candidates already pass the desk's rules; choose among them or hold.`,
    "Write like a trader's log: concrete numbers, no hype, no emojis.",
  ].join("\n");
  const user = [
    `Mandate: ${mandate}`,
    `Portfolio: ${book}`,
    `Already covered (active policies): ${covered.size ? [...covered].join(", ") : "nothing"}`,
    `Screener findings this cycle:\n${findings.length ? findings.slice(0, 8).map((f) => `- ${f.text}`).join("\n") : "- none (periodic review)"}`,
    `Candidate hedges that pass the rules:\n${passing.length ? passing.map(fmtCandidate).join("\n") : "- none"}`,
    rejected.length ? `Rejected by the rules (for context):\n${rejected.slice(0, 6).map((c) => `- ${c.market.question}: ${c.why}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

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

// --- loop ------------------------------------------------------------------------------------------
let running = false;

/** Value the holdings at Gemini spot, so the app shows them even while the autopilot is off. */
async function refreshValuation() {
  const v: typeof lastValuation = [];
  for (const h of holdings()) {
    const spot = await getSpot(h.asset);
    v.push({ ...h, spot: spot ?? null, valueUsd: spot ? spot * h.amount : null });
  }
  lastValuation = v;
}

/** Called by the job loop after each screener pass. */
export async function runAutopilot(findings: Finding[], markets: MarketView[]) {
  await refreshValuation().catch(() => undefined);
  const st = autopilotState();
  if (!st.enabled || !agentEnabled() || running) return;
  const t = now();
  const covered = activePolicyAssets();
  const book = holdings();
  // a finding only matters if it concerns an asset we hold and haven't covered yet
  const relevant = findings.filter((f) => book.some((h) => h.asset === f.market.asset) && !covered.has(f.market.asset ?? ""));
  const due = relevant.length > 0 ? t - (st.lastDecisionAt ?? 0) >= MIN_GAP_SEC : t - (st.lastReviewAt ?? 0) >= REVIEW_EVERY_SEC;
  if (!due) return;

  running = true;
  try {
    kvSet("autopilot:lastDecisionAt", String(t));
    kvSet("autopilot:lastReviewAt", String(t));
    const all = await buildCandidates(markets);
    const open = all.filter((c) => !covered.has(c.asset));
    const passing = open.filter((c) => c.pass).slice(0, 12);
    const rejected = open.filter((c) => !c.pass);
    const reviewed = relevant.length ? `${relevant.length} relevant finding${relevant.length > 1 ? "s" : ""}` : "periodic review";

    // everything held is covered: say so without spending a Grok call
    if (book.every((h) => covered.has(h.asset))) {
      logEvent("decision", "Hold\nportfolio fully covered", {
        detail: `${[...covered].join(" and ")} already have active cover. Waiting for those windows to settle. (${reviewed})`,
      });
      return;
    }

    const d = await decide(st.mandate, relevant, passing, rejected, covered);
    const pick = d.instrumentSymbol ? passing.find((c) => c.market.instrumentSymbol === d.instrumentSymbol) : undefined;

    if (d.action !== "buy" || !pick) {
      logEvent("decision", `Hold\n${d.headline}`, { detail: `${d.reasoning} (${reviewed})` });
      return;
    }
    // server-side re-check of Grok's pick: size within bounds, asset not covered meanwhile
    const payout = Math.max(1, Math.min(pick.maxPayout, d.payout ?? pick.suggestedPayout));
    if (activePolicyAssets().has(pick.asset)) {
      logEvent("decision", `Hold\n${pick.asset} already covered`, { detail: d.reasoning, symbol: pick.market.instrumentSymbol });
      return;
    }
    logEvent("decision", `Buy\n${d.headline}`, {
      detail: `${d.reasoning} [spot $${pick.spot.toLocaleString("en-US", { maximumFractionDigits: 2 })}, strike ${pct(pick.distance)}, ${pick.cost.toFixed(2)} per $1, ${payout} USDC vs ≈$${Math.round(pick.holdingValue * RULES.hedgeMove)} loss on a 1% drop] (${reviewed})`,
      symbol: pick.market.instrumentSymbol,
    });
    await buyCover(
      { market: pick.market, outcome: "no", payout, maxAsk: pick.ask },
      { instruction: `Autopilot: ${st.mandate}`, summary: d.headline, reasoning: d.reasoning, source: "autopilot" },
    );
  } catch (e) {
    logEvent("error", "Autopilot decision failed", { detail: (e as Error).message.split("\n")[0] });
  } finally {
    running = false;
  }
}
