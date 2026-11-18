// The agent's background jobs, run on an interval:
//   1. market screener: reads every live Gemini market and logs what's notable
//   2. on-chain watcher: follows the agent's policies on Arc and logs each state change
//   3. watches: standing orders that buy cover when the screener finds a match
import { agentAddress, agentEnabled, listWatches, logEvent, marketsForAgent, runWatches } from "./agent.js";
import { backstopAbi, backstopAddress, publicClient } from "./chain.js";
import { cfg } from "./config.js";
import { db } from "./db.js";
import type { MarketView } from "./markets.js";
import { autopilotState, runAutopilot, type Finding } from "./autopilot.js";
import { formatUsdc } from "./quotes.js";

type JobStat = { lastRunAt: number | null; lastMs: number | null; lastError: string | null; runs: number };
const blank = (): JobStat => ({ lastRunAt: null, lastMs: null, lastError: null, runs: 0 });
const stats = {
  screener: { ...blank(), marketsScanned: 0, findings: 0 },
  onchain: { ...blank(), policiesTracked: 0, freeLiquidityUsdc: null as string | null },
  watches: { ...blank() },
};

const assetOf = (s: string) => (s.startsWith("GEMI-") ? (s.slice(5).includes("-") && !/^[A-Z]+\d/.test(s.slice(5)) ? s.slice(5).split("-")[0]! : (/^GEMI-([A-Z]+?)(?:05M|15M|1H|\d)/.exec(s)?.[1] ?? "")) : "");

// --- 1. market screener ---------------------------------------------------------------------------
const lastAsk = new Map<string, { yes: number; no: number }>();
const flaggedCheap = new Set<string>();
let firstScan = true;

function screen(markets: MarketView[]): Finding[] {
  const found: Finding[] = [];
  const opened: MarketView[] = [];
  for (const m of markets) {
    if (m.category === "sports") continue; // game odds move constantly; not useful for hedging findings
    const prev = lastAsk.get(m.instrumentSymbol);
    if (!prev && !firstScan && (m.kind === "15m" || /1H$/.test(m.series ?? ""))) opened.push(m);
    if (prev) {
      for (const side of ["yes", "no"] as const) {
        const now = side === "yes" ? m.askYes : m.askNo;
        const d = now - prev[side];
        if (Math.abs(d) >= 0.08) {
          found.push({
            kind: "move",
            market: m,
            side,
            prev: prev[side],
            now,
            text: `${m.question}: ${side.toUpperCase()} ask ${d > 0 ? "jumped" : "dropped"} ${prev[side].toFixed(2)} → ${now.toFixed(2)} (closes in ${Math.round(m.secondsToExpiry / 60)} min)`,
          });
          logEvent("finding", `${assetOf(m.instrumentSymbol)} ${side.toUpperCase()} ${d > 0 ? "jumped" : "dropped"} ${prev[side].toFixed(2)} → ${now.toFixed(2)}`, {
            detail: `${m.question}. ${d > 0 ? "Cover on this side just got more expensive." : "Cover on this side just got cheaper."}`,
            symbol: m.instrumentSymbol,
          });
        }
      }
    }
    // cheap tail cover with time left: worth flagging once (crypto and commodities; sub-5¢ tails are noise)
    for (const side of ["yes", "no"] as const) {
      const ask = side === "yes" ? m.askYes : m.askNo;
      const key = `${m.instrumentSymbol}:${side}`;
      const cheap = ask >= 0.05 && ask <= 0.15 && m.secondsToExpiry > 300 && (m.category === "crypto" || m.category === "commodities");
      if (cheap && !flaggedCheap.has(key)) {
        flaggedCheap.add(key);
        if (firstScan) continue; // the first pass only records the baseline
        found.push({ kind: "cheap", market: m, side, now: ask, text: `${m.question}: ${side.toUpperCase()} cover is cheap at ${ask.toFixed(2)}` });
        logEvent("finding", `Cheap tail cover: ${assetOf(m.instrumentSymbol)} ${side.toUpperCase()} at ${ask.toFixed(2)}`, {
          detail: `${m.question}. 1 USDC of cover costs ${(ask + cfg.SPREAD).toFixed(2)} USDC.`,
          symbol: m.instrumentSymbol,
        });
      }
    }
    lastAsk.set(m.instrumentSymbol, { yes: m.askYes, no: m.askNo });
  }
  if (opened.length) {
    for (const m of opened) found.push({ kind: "opened", market: m, text: `New window: ${m.question} (YES ${m.askYes.toFixed(2)} / NO ${m.askNo.toFixed(2)})` });
    const list = opened;
    logEvent("scan", `${list.length} new window${list.length > 1 ? "s" : ""} opened`, {
      detail: [...new Set(list.map((m) => `${assetOf(m.instrumentSymbol)} ${m.kind === "15m" ? "15 min" : "1 h"}`))].join(", "),
    });
  }
  firstScan = false;
  return found;
}

// --- 2. on-chain watcher --------------------------------------------------------------------------
type Snap = { status: string; hedge: string; result: number | null };
const seen = new Map<number, Snap>();

async function watchChain() {
  const free = (await publicClient.readContract({ address: backstopAddress, abi: backstopAbi, functionName: "freeLiquidity" })) as bigint;
  const freeUsdc = formatUsdc(free);
  if (stats.onchain.freeLiquidityUsdc !== null && stats.onchain.freeLiquidityUsdc !== freeUsdc) {
    logEvent("onchain", `Treasury free liquidity ${stats.onchain.freeLiquidityUsdc} → ${freeUsdc} USDC`);
  }
  stats.onchain.freeLiquidityUsdc = freeUsdc;

  if (!agentAddress) return;
  const rows = db
    .prepare(
      `SELECT p.policy_id, p.instrument_symbol, p.status, p.hedge_status, p.hedge_fill_price, p.hedge_filled_qty, p.hedge_mode,
              p.payout, p.outcome, p.settle_tx, p.refund_tx, m.result, m.resolve_tx
       FROM policies p LEFT JOIN markets m ON m.market_id = p.market_id
       WHERE p.buyer = ? ORDER BY p.policy_id DESC LIMIT 30`,
    )
    .all(agentAddress.toLowerCase()) as {
    policy_id: number;
    instrument_symbol: string;
    status: string;
    hedge_status: string;
    hedge_fill_price: string | null;
    hedge_filled_qty: string | null;
    hedge_mode: string | null;
    payout: string;
    outcome: number;
    settle_tx: string | null;
    refund_tx: string | null;
    result: number | null;
    resolve_tx: string | null;
  }[];
  stats.onchain.policiesTracked = rows.filter((r) => r.status === "active").length;

  for (const r of rows) {
    const prev = seen.get(r.policy_id);
    const cur: Snap = { status: r.status, hedge: r.hedge_status, result: r.result };
    seen.set(r.policy_id, cur);
    if (!prev) continue; // first sighting after a restart: don't replay history
    const id = r.policy_id;
    const side = r.outcome === 1 ? "YES" : "NO";
    if (prev.hedge !== cur.hedge && cur.hedge === "filled")
      logEvent("onchain", `Policy No. ${id} hedged on Gemini: ${r.hedge_filled_qty} ${side} at ${r.hedge_fill_price}`, {
        detail: `Order placed by the backend (${r.hedge_mode}).`,
        symbol: r.instrument_symbol,
        policyId: id,
      });
    if (prev.hedge !== cur.hedge && cur.hedge === "failed")
      logEvent("onchain", `Policy No. ${id}: hedge didn't fill, premium being refunded`, { symbol: r.instrument_symbol, policyId: id });
    if (prev.result == null && cur.result != null)
      logEvent("onchain", `Market resolved ${cur.result === 1 ? "YES" : "NO"} for policy No. ${id}`, {
        symbol: r.instrument_symbol,
        policyId: id,
        tx: r.resolve_tx ?? undefined,
      });
    if (prev.status !== cur.status && cur.status === "paid_out")
      logEvent("onchain", `Policy No. ${id} paid out ${formatUsdc(BigInt(r.payout))} USDC to the agent wallet`, {
        symbol: r.instrument_symbol,
        policyId: id,
        tx: r.settle_tx ?? undefined,
      });
    if (prev.status !== cur.status && cur.status === "expired")
      logEvent("onchain", `Policy No. ${id} expired: the covered outcome didn't happen`, { symbol: r.instrument_symbol, policyId: id, tx: r.settle_tx ?? undefined });
    if (prev.status !== cur.status && cur.status === "refunded")
      logEvent("onchain", `Policy No. ${id} refunded`, { symbol: r.instrument_symbol, policyId: id, tx: r.refund_tx ?? undefined });
  }
}

// --- runner ---------------------------------------------------------------------------------------
async function timed<T extends JobStat>(stat: T, fn: () => Promise<void>) {
  const t = Date.now();
  try {
    await fn();
    stat.lastError = null;
  } catch (e) {
    stat.lastError = (e as Error).message.split("\n")[0]!.slice(0, 200);
  } finally {
    stat.lastRunAt = Math.floor(Date.now() / 1000);
    stat.lastMs = Date.now() - t;
    stat.runs++;
  }
}

let busy = false;
export async function runJobsOnce() {
  if (busy || !agentEnabled()) return;
  busy = true;
  try {
    let markets: MarketView[] = [];
    let found: Finding[] = [];
    await timed(stats.screener, async () => {
      markets = await marketsForAgent();
      stats.screener.marketsScanned = markets.length;
      found = screen(markets);
      stats.screener.findings += found.length;
    });
    await timed(stats.onchain, watchChain);
    if (markets.length) await timed(stats.watches, () => runWatches(markets));
    // Grok acts on what the screener found (runs in the background so the loop keeps its rhythm)
    if (markets.length) void runAutopilot(found, markets);
  } finally {
    busy = false;
  }
}

export function jobsStatus() {
  return {
    intervalSec: Math.round(cfg.SCREENER_INTERVAL_MS / 1000),
    autopilot: autopilotState(),
    screener: stats.screener,
    onchain: stats.onchain,
    watches: {
      ...stats.watches,
      list: listWatches().map((w) => ({
        id: w.id,
        asset: w.asset,
        outcome: w.outcome,
        horizon: w.horizon,
        payout: w.payout,
        maxPrice: w.max_price,
        note: w.note,
        createdAt: w.created_at,
        lastRun: w.last_run,
        lastResult: w.last_result,
      })),
    },
  };
}
