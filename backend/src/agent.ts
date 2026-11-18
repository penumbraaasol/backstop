// Grok agent: buys cover on Arc from its own testnet wallet, with no human signature.
// Every path (button, chat, standing watches) goes through buyCover(), which enforces the limits
// and logs the decision. Grok chooses; the backend checks and executes.
import { createWalletClient, erc20Abi, http, parseEventLogs, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { suggestCover } from "./assist.js";
import { arcTestnet, backstopAbi, backstopAddress, publicClient, txUrl, USDC_UNIT, usdcAddress } from "./chain.js";
import { cfg } from "./config.js";
import { db, now } from "./db.js";
import { curatedMarkets, type MarketView } from "./markets.js";
import { formatUsdc, makeQuote, QuoteError } from "./quotes.js";

const account = cfg.PRIVATE_KEY_AGENT ? privateKeyToAccount(cfg.PRIVATE_KEY_AGENT as Hex) : undefined;
const wallet = account ? createWalletClient({ account, chain: arcTestnet, transport: http(cfg.ARC_RPC_URL) }) : undefined;

export const agentAddress = account?.address;
export const agentEnabled = () => !!(cfg.AGENT_ENABLED && account && cfg.GROK_API_KEY);

export type Source = "button" | "chat" | "watch" | "autopilot";

type AgentActionRow = {
  id: number;
  at: number;
  instruction: string;
  summary: string;
  reasoning: string;
  instrument_symbol: string | null;
  outcome: string | null;
  payout: number | null;
  premium: string | null;
  policy_id: number | null;
  tx: string | null;
  status: "bought" | "declined" | "blocked" | "failed";
  error: string | null;
  model: string;
  source: Source;
};

// --- activity feed -----------------------------------------------------------------------------
export type EventKind = "scan" | "finding" | "onchain" | "action" | "watch" | "error" | "decision";

export function logEvent(
  kind: EventKind,
  title: string,
  extra: { detail?: string; symbol?: string; policyId?: number; tx?: string } = {},
) {
  db.prepare(
    "INSERT INTO agent_events (at, kind, title, detail, instrument_symbol, policy_id, tx) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(now(), kind, title, extra.detail ?? null, extra.symbol ?? null, extra.policyId ?? null, extra.tx ?? null);
}

export function recentEvents(limit = 40) {
  const rows = db.prepare("SELECT * FROM agent_events ORDER BY id DESC LIMIT ?").all(limit) as {
    id: number;
    at: number;
    kind: EventKind;
    title: string;
    detail: string | null;
    instrument_symbol: string | null;
    policy_id: number | null;
    tx: string | null;
  }[];
  return rows.map((r) => ({
    id: r.id,
    at: r.at,
    kind: r.kind,
    title: r.title,
    detail: r.detail,
    instrumentSymbol: r.instrument_symbol,
    policyId: r.policy_id,
    tx: r.tx,
    url: r.tx ? txUrl(r.tx) : null,
  }));
}

// --- limits ------------------------------------------------------------------------------------
const startOfUtcDay = () => {
  const d = new Date();
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000);
};

export function spentToday(): bigint {
  const rows = db
    .prepare("SELECT premium FROM agent_actions WHERE status = 'bought' AND at >= ?")
    .all(startOfUtcDay()) as { premium: string }[];
  return rows.reduce((s, r) => s + BigInt(r.premium), 0n);
}

export const dailyBudget = () => BigInt(Math.round(cfg.AGENT_DAILY_BUDGET_USDC * 1_000_000));

export async function agentBalance() {
  return agentAddress
    ? await publicClient.readContract({ address: usdcAddress, abi: erc20Abi, functionName: "balanceOf", args: [agentAddress] })
    : 0n;
}

// --- status for the UI -------------------------------------------------------------------------
export async function agentStatus() {
  const balance = await agentBalance();
  const actions = db.prepare("SELECT * FROM agent_actions ORDER BY id DESC LIMIT 20").all() as AgentActionRow[];
  return {
    enabled: agentEnabled(),
    address: agentAddress ?? null,
    balanceUsdc: formatUsdc(balance),
    maxPayoutUsdc: cfg.AGENT_MAX_PAYOUT,
    dailyBudgetUsdc: formatUsdc(dailyBudget()),
    spentTodayUsdc: formatUsdc(spentToday()),
    model: cfg.GROK_MODEL,
    screenerIntervalSec: Math.round(cfg.SCREENER_INTERVAL_MS / 1000),
    sampleMarkets: cfg.MOCK_MARKETS,
    actions: actions.map((a) => ({
      id: a.id,
      at: a.at,
      source: a.source,
      instruction: a.instruction,
      summary: a.summary,
      reasoning: a.reasoning,
      instrumentSymbol: a.instrument_symbol,
      outcome: a.outcome,
      payout: a.payout,
      premiumUsdc: a.premium ? formatUsdc(BigInt(a.premium)) : null,
      policyId: a.policy_id,
      tx: a.tx,
      url: a.tx ? txUrl(a.tx) : null,
      status: a.status,
      error: a.error,
      model: a.model,
    })),
  };
}

function record(a: Omit<AgentActionRow, "id" | "at" | "model"> & { model?: string }) {
  const r = db
    .prepare(
      `INSERT INTO agent_actions (at, instruction, summary, reasoning, instrument_symbol, outcome, payout, premium, policy_id, tx, status, error, model, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      now(),
      a.instruction,
      a.summary,
      a.reasoning,
      a.instrument_symbol,
      a.outcome,
      a.payout,
      a.premium,
      a.policy_id,
      a.tx,
      a.status,
      a.error,
      a.model ?? cfg.GROK_MODEL,
      a.source,
    );
  return Number(r.lastInsertRowid);
}

// one purchase at a time, so the agent wallet's nonces never collide
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const job = queue.then(fn);
  queue = job.catch(() => undefined);
  return job;
}

export type BuyResult =
  | { status: "bought"; actionId: number; policyId: number; tx: string; url: string; premiumUsdc: string; payout: number }
  | { status: "blocked" | "failed"; actionId: number; error: string };

/** The only way the agent spends money. Checks limits, buys with a signed quote, logs everything. */
export function buyCover(
  pick: { market: MarketView; outcome: "yes" | "no"; payout: number; /** refuse if the live ask is above this */ maxAsk?: number },
  meta: { instruction: string; summary: string; reasoning: string; source: Source },
): Promise<BuyResult> {
  return serial(async () => {
    if (!agentEnabled() || !account || !wallet) throw new QuoteError("The Grok agent is switched off on this server.", "agent_off", 503);
    const payout = Math.max(1, Math.min(Math.round(pick.payout), cfg.AGENT_MAX_PAYOUT));
    const base = { ...meta, instrument_symbol: pick.market.instrumentSymbol, outcome: pick.outcome, payout };
    const fail = (status: "blocked" | "failed", error: string, premium: bigint | null = null) => {
      const actionId = record({ ...base, premium: premium?.toString() ?? null, policy_id: null, tx: null, status, error });
      logEvent(status === "blocked" ? "watch" : "error", status === "blocked" ? "Purchase blocked by limits" : "Purchase failed", {
        detail: error,
        symbol: pick.market.instrumentSymbol,
      });
      return { status, actionId, error } as const;
    };

    try {
      const q = await makeQuote({
        buyer: account.address,
        instrumentSymbol: pick.market.instrumentSymbol,
        eventTicker: pick.market.eventTicker,
        outcome: pick.outcome,
        payout,
      });
      const premium = BigInt(q.quote.premium);
      // the price may have moved since the decision: never pay more than 2¢ above what was decided on
      if (pick.maxAsk !== undefined && q.breakdown.price > pick.maxAsk + 0.02)
        return fail("blocked", `Price moved: ${pick.outcome.toUpperCase()} is now ${q.breakdown.price.toFixed(2)}, decided at ${pick.maxAsk.toFixed(2)}. Nothing bought.`, premium);

      const spent = spentToday();
      if (spent + premium > dailyBudget())
        return fail(
          "blocked",
          `Daily budget: ${formatUsdc(spent)} of ${formatUsdc(dailyBudget())} USDC already spent, this policy costs ${formatUsdc(premium)}.`,
          premium,
        );
      const balance = await agentBalance();
      if (balance < premium + USDC_UNIT / 20n)
        return fail("blocked", `Agent wallet has ${formatUsdc(balance)} USDC, not enough for ${formatUsdc(premium)} plus gas.`, premium);

      const allowance = await publicClient.readContract({
        address: usdcAddress,
        abi: erc20Abi,
        functionName: "allowance",
        args: [account.address, backstopAddress],
      });
      if (allowance < premium) {
        const h = await wallet.writeContract({ address: usdcAddress, abi: erc20Abi, functionName: "approve", args: [backstopAddress, premium] });
        await publicClient.waitForTransactionReceipt({ hash: h });
      }
      const quote = {
        buyer: q.quote.buyer as Address,
        marketId: q.quote.marketId as Hex,
        outcome: Number(q.quote.outcome),
        payout: BigInt(q.quote.payout),
        premium,
        quoteExpiry: BigInt(q.quote.quoteExpiry),
        resolveBy: BigInt(q.quote.resolveBy),
        nonce: BigInt(q.quote.nonce),
      };
      const { request } = await publicClient.simulateContract({
        account,
        address: backstopAddress,
        abi: backstopAbi,
        functionName: "buyPolicy",
        args: [quote, q.signature, q.instrumentSymbol],
      });
      const tx = await wallet.writeContract(request);
      const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
      if (receipt.status !== "success") throw new Error(`buyPolicy reverted: ${tx}`);
      const [ev] = parseEventLogs({ abi: backstopAbi, logs: receipt.logs, eventName: "PolicyPurchased" });
      const policyId = Number(ev?.args.policyId ?? 0);

      const actionId = record({ ...base, premium: premium.toString(), policy_id: policyId, tx, status: "bought", error: null });
      logEvent("action", `Bought policy No. ${policyId}: ${payout} USDC if ${pick.outcome.toUpperCase()}`, {
        detail: `${pick.market.question}. Paid ${formatUsdc(premium)} USDC (${meta.source}).`,
        symbol: pick.market.instrumentSymbol,
        policyId,
        tx,
      });
      return { status: "bought", actionId, policyId, tx, url: txUrl(tx), premiumUsdc: formatUsdc(premium), payout } as const;
    } catch (e) {
      let error = e instanceof QuoteError ? e.message : ((e as { shortMessage?: string }).shortMessage ?? (e as Error).message);
      if (/Gemini .*HTTP 5\d\d/.test(error)) error = "Gemini's market API isn't responding, so no price could be locked. Nothing was spent.";
      return fail("failed", error);
    }
  });
}

/** "Let Grok buy it": one instruction, Grok picks, the agent buys. */
export async function runAgent(instruction: string) {
  if (!agentEnabled()) throw new QuoteError("The Grok agent is switched off on this server.", "agent_off", 503);
  const s = await suggestCover(instruction);
  const meta = { instruction, summary: s.summary, reasoning: s.reasoning, source: "button" as const };
  if (!s.instrumentSymbol || !s.outcome || !s.market) {
    const id = record({ ...meta, instrument_symbol: null, outcome: null, payout: null, premium: null, policy_id: null, tx: null, status: "declined", error: null });
    return { id, status: "declined" as const, summary: s.summary, reasoning: s.reasoning };
  }
  const r = await buyCover({ market: s.market, outcome: s.outcome, payout: s.payout ?? 1 }, meta);
  return { ...r, id: r.actionId, summary: s.summary, reasoning: s.reasoning };
}

// --- standing watches ---------------------------------------------------------------------------
export type WatchRow = {
  id: number;
  created_at: number;
  asset: string;
  outcome: "yes" | "no";
  horizon: "5m" | "15m" | "1h";
  payout: number;
  max_price: number;
  note: string;
  active: number;
  last_symbol: string | null;
  last_run: number | null;
  last_result: string | null;
};

export function listWatches(all = false) {
  return db.prepare(`SELECT * FROM agent_watches ${all ? "" : "WHERE active = 1"} ORDER BY id DESC LIMIT 20`).all() as WatchRow[];
}

export function createWatch(w: { asset: string; outcome: "yes" | "no"; horizon: "5m" | "15m" | "1h"; payout: number; maxPrice: number; note: string }) {
  if (listWatches().length >= 3) throw new QuoteError("The agent runs at most 3 watches at once. Stop one first.", "too_many_watches", 409);
  const payout = Math.max(1, Math.min(Math.round(w.payout), cfg.AGENT_MAX_PAYOUT));
  const maxPrice = Math.min(0.9, Math.max(0.05, w.maxPrice));
  const r = db
    .prepare("INSERT INTO agent_watches (created_at, asset, outcome, horizon, payout, max_price, note) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(now(), w.asset.toUpperCase(), w.outcome, w.horizon, payout, maxPrice, w.note);
  const id = Number(r.lastInsertRowid);
  logEvent("watch", `Watch #${id} started: ${payout} USDC on ${w.asset.toUpperCase()} ${w.outcome.toUpperCase()}, every ${w.horizon} window`, {
    detail: `Buys once per window while cover costs at most ${maxPrice.toFixed(2)}. ${w.note}`,
  });
  return id;
}

export function stopWatch(id: number) {
  const r = db.prepare("UPDATE agent_watches SET active = 0 WHERE id = ? AND active = 1").run(id);
  if (r.changes) logEvent("watch", `Watch #${id} stopped`);
  return r.changes > 0;
}

const horizonOf = (m: MarketView) => (m.kind === "5m" ? "5m" : m.kind === "15m" ? "15m" : /1H$/.test(m.series ?? "") ? "1h" : "later");
const assetOf = (m: MarketView) => /^GEMI-([A-Z]+?)(?:05M|15M|1H|\d)/.exec(m.instrumentSymbol)?.[1] ?? "";

// after a failed purchase, a watch waits before retrying the same window (keeps the feed readable)
const backoff = new Map<number, { symbol: string; until: number }>();

/** For each watch: find the soonest window it hasn't covered yet and buy if the price is within its limit. */
export async function runWatches(markets: MarketView[]) {
  for (const w of listWatches()) {
    const candidates = markets
      .filter((m) => assetOf(m) === w.asset && horizonOf(m) === w.horizon && m.secondsToExpiry > 120)
      .sort((a, b) => a.secondsToExpiry - b.secondsToExpiry);
    const m = candidates[0];
    const setRun = (result: string, symbol = w.last_symbol) =>
      db.prepare("UPDATE agent_watches SET last_run = ?, last_result = ?, last_symbol = ? WHERE id = ?").run(now(), result, symbol, w.id);
    if (!m) {
      setRun("No open window yet");
      continue;
    }
    if (m.instrumentSymbol === w.last_symbol) {
      setRun(`Covered this window (${m.question})`);
      continue;
    }
    const b = backoff.get(w.id);
    if (b && b.symbol === m.instrumentSymbol && Date.now() < b.until) continue;
    const ask = w.outcome === "yes" ? m.askYes : m.askNo;
    if (ask > w.max_price) {
      setRun(`Waiting: ${w.outcome.toUpperCase()} costs ${ask.toFixed(2)}, limit ${w.max_price.toFixed(2)}`);
      continue;
    }
    const r = await buyCover(
      { market: m, outcome: w.outcome, payout: w.payout, maxAsk: w.max_price },
      {
        instruction: `Watch #${w.id}: ${w.note}`,
        summary: `Cover ${w.payout} USDC if ${w.outcome === "no" ? "not " : ""}${m.question}`,
        reasoning: `Standing order: ${w.asset} ${w.outcome.toUpperCase()} on each ${w.horizon} window while the ask is at or below ${w.max_price.toFixed(2)}. This window's ask is ${ask.toFixed(2)}.`,
        source: "watch",
      },
    );
    if (r.status !== "bought") backoff.set(w.id, { symbol: m.instrumentSymbol, until: Date.now() + 120_000 });
    setRun(
      r.status === "bought" ? `Bought policy No. ${r.policyId} at ${ask.toFixed(2)}` : `Retrying in 2 min: ${r.error}`,
      r.status === "bought" ? m.instrumentSymbol : w.last_symbol,
    );
  }
}

export async function marketsForAgent() {
  return curatedMarkets("all", 3);
}
