import Fastify from "fastify";
import cors from "@fastify/cors";
import { getAddress, isAddress } from "viem";
import { z } from "zod";
import { cfg } from "./config.js";
import { arcTestnet, backstopAbi, backstopAddress, publicClient, resolverAccount, signerAccount, txUrl, usdcAddress } from "./chain.js";
import { db, type MarketRow, type PolicyRow } from "./db.js";
import { hedgePending } from "./hedger.js";
import { indexOnce } from "./indexer.js";
import { curatedMarkets } from "./markets.js";
import { formatUsdc, makeQuote, QuoteError } from "./quotes.js";
import { resolveOnce } from "./resolver.js";
import { allowAssist, suggestCover } from "./assist.js";
import { agentAddress, agentEnabled, agentStatus, recentEvents, runAgent, stopWatch } from "./agent.js";
import { chat, chatBody } from "./chat.js";
import { autopilotState, setAutopilot } from "./autopilot.js";
import { jobsStatus, runJobsOnce } from "./jobs.js";

const app = Fastify({ logger: { level: "info" }, disableRequestLogging: true });
await app.register(cors, { origin: true });

app.get("/health", async () => ({ ok: true, hedgeMode: cfg.HEDGE_MODE }));

app.get("/config", async () => ({
  chainId: arcTestnet.id,
  rpcUrl: cfg.ARC_RPC_URL,
  explorerUrl: cfg.ARC_EXPLORER_URL,
  backstopAddress,
  usdcAddress,
  quoteSigner: signerAccount.address,
  resolver: resolverAccount.address,
  hedgeMode: cfg.HEDGE_MODE,
  assistant: !!cfg.GROK_API_KEY,
  agent: agentEnabled() ? agentAddress : null,
  spread: cfg.SPREAD,
  maxSlippage: cfg.MAX_SLIPPAGE,
}));

app.get("/stats", async () => {
  const read = (fn: string) =>
    publicClient.readContract({ address: backstopAddress, abi: backstopAbi, functionName: fn as never }) as Promise<bigint>;
  const [free, locked, maxPayout, maxExposure] = await Promise.all([
    read("freeLiquidity"),
    read("lockedLiquidity"),
    read("maxPayoutPerPolicy"),
    read("maxExposurePerMarket"),
  ]);
  return {
    freeLiquidityUsdc: formatUsdc(free),
    lockedLiquidityUsdc: formatUsdc(locked),
    maxPayoutUsdc: formatUsdc(maxPayout),
    maxExposurePerMarketUsdc: formatUsdc(maxExposure),
  };
});

app.get("/markets", async (req) => {
  const q = req.query as { category?: string; perSeries?: string };
  return { markets: await curatedMarkets(q.category ?? "all", Number(q.perSeries ?? 3)) };
});

const quoteBody = z.object({
  buyer: z.string().refine((a) => isAddress(a), "invalid address"),
  instrumentSymbol: z.string().min(5),
  outcome: z.enum(["yes", "no"]),
  payout: z.coerce.number().int().positive(),
  eventTicker: z.string().optional(),
});

app.post("/quote", async (req, reply) => {
  const parsed = quoteBody.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: "bad_request", message: parsed.error.issues[0]?.message });
  try {
    return await makeQuote(parsed.data);
  } catch (e) {
    if (e instanceof QuoteError) return reply.code(e.status).send({ error: e.code, message: e.message });
    req.log.error(e);
    return reply.code(502).send({ error: "upstream", message: (e as Error).message });
  }
});

const assistBody = z.object({ message: z.string().trim().min(3).max(500) });

app.post("/assist", async (req, reply) => {
  const parsed = assistBody.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: "bad_request", message: "Describe your risk in a sentence." });
  if (!allowAssist(req.ip)) return reply.code(429).send({ error: "rate_limited", message: "Too many requests. Try again in a minute." });
  try {
    return await suggestCover(parsed.data.message);
  } catch (e) {
    if (e instanceof QuoteError) return reply.code(e.status).send({ error: e.code, message: e.message });
    req.log.error(e);
    return reply.code(502).send({ error: "upstream", message: (e as Error).message });
  }
});

app.get("/agent", async () => agentStatus());
app.get("/agent/activity", async () => ({ jobs: jobsStatus(), events: recentEvents(40) }));

app.post("/agent/chat", async (req, reply) => {
  const parsed = chatBody.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: "bad_request", message: "Send a message." });
  if (!allowAssist(req.ip, 8)) return reply.code(429).send({ error: "rate_limited", message: "Too many messages. Give it a minute." });
  try {
    return await chat(parsed.data.messages);
  } catch (e) {
    if (e instanceof QuoteError) return reply.code(e.status).send({ error: e.code, message: e.message });
    req.log.error(e);
    return reply.code(502).send({ error: "upstream", message: (e as Error).message });
  }
});

const autopilotBody = z.object({
  enabled: z.boolean().optional(),
  mandate: z.string().trim().min(10).max(400).optional(),
  holdings: z.array(z.object({ asset: z.string().min(2).max(6), amount: z.coerce.number().positive() })).min(1).max(4).optional(),
});
app.get("/agent/autopilot", async () => autopilotState());
app.post("/agent/autopilot", async (req, reply) => {
  const parsed = autopilotBody.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: "bad_request", message: "Mandate must be 10–400 characters." });
  return setAutopilot(parsed.data);
});

app.post("/agent/watches/:id/stop", async (req) => ({ stopped: stopWatch(Number((req.params as { id: string }).id)) }));

app.post("/agent/run", async (req, reply) => {
  const parsed = assistBody.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: "bad_request", message: "Tell the agent what to protect against." });
  if (!allowAssist(req.ip, 3)) return reply.code(429).send({ error: "rate_limited", message: "The agent takes 3 instructions a minute. Try again shortly." });
  try {
    return await runAgent(parsed.data.message);
  } catch (e) {
    if (e instanceof QuoteError) return reply.code(e.status).send({ error: e.code, message: e.message });
    req.log.error(e);
    return reply.code(502).send({ error: "upstream", message: (e as Error).message });
  }
});

function timeline(p: PolicyRow, m: MarketRow | undefined) {
  const usdc = (s: string) => formatUsdc(BigInt(s));
  return {
    policyId: p.policy_id,
    buyer: p.buyer,
    instrumentSymbol: p.instrument_symbol,
    eventTicker: p.event_ticker,
    marketTitle: p.market_title,
    marketExpiry: p.market_expiry,
    outcome: p.outcome === 1 ? "yes" : "no",
    payoutUsdc: usdc(p.payout),
    premiumUsdc: usdc(p.premium),
    quotedPrice: p.quoted_price,
    resolveBy: p.resolve_by,
    status: p.status,
    steps: {
      purchased: { done: true, tx: p.purchase_tx, url: txUrl(p.purchase_tx) },
      hedged: {
        status: p.hedge_status,
        mode: p.hedge_mode,
        orderId: p.hedge_order_id,
        fillPrice: p.hedge_fill_price,
        filledQty: p.hedge_filled_qty,
        error: p.hedge_error,
        at: p.hedge_at,
      },
      resolved: m?.result
        ? { done: true, result: m.result === 1 ? "yes" : "no", tx: m.resolve_tx, url: m.resolve_tx ? txUrl(m.resolve_tx) : null }
        : { done: false },
      settled:
        p.status === "paid_out" || p.status === "expired"
          ? { done: true, paid: p.status === "paid_out", tx: p.settle_tx, url: p.settle_tx ? txUrl(p.settle_tx) : null }
          : p.status === "refunded"
            ? { done: true, refunded: true, tx: p.refund_tx, url: p.refund_tx ? txUrl(p.refund_tx) : null }
            : { done: false },
    },
  };
}

app.get("/policies/:address", async (req, reply) => {
  const { address } = req.params as { address: string };
  if (!isAddress(address)) return reply.code(400).send({ error: "bad_address" });
  const rows = db
    .prepare("SELECT * FROM policies WHERE buyer = ? ORDER BY policy_id DESC LIMIT 50")
    .all(getAddress(address).toLowerCase()) as PolicyRow[];
  const markets = new Map(
    (db.prepare("SELECT * FROM markets").all() as MarketRow[]).map((m) => [m.market_id, m]),
  );
  return { policies: rows.map((p) => timeline(p, markets.get(p.market_id))) };
});

app.get("/policy/:id", async (req, reply) => {
  const id = Number((req.params as { id: string }).id);
  const p = db.prepare("SELECT * FROM policies WHERE policy_id = ?").get(id) as PolicyRow | undefined;
  if (!p) return reply.code(404).send({ error: "not_found" });
  const m = db.prepare("SELECT * FROM markets WHERE market_id = ?").get(p.market_id) as MarketRow | undefined;
  return timeline(p, m);
});

// --- background workers -----------------------------------------------------
function loop(name: string, ms: number, fn: () => Promise<void>) {
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await fn();
    } catch (e) {
      app.log.warn(`[${name}] ${(e as Error).message}`);
    } finally {
      busy = false;
    }
  }, ms);
}

if (cfg.RUN_WORKERS) {
  loop("indexer+hedger", cfg.POLL_INTERVAL_MS, async () => {
    await indexOnce();
    await hedgePending();
  });
  loop("resolver", cfg.RESOLVER_INTERVAL_MS, resolveOnce);
  loop("agent-jobs", cfg.SCREENER_INTERVAL_MS, runJobsOnce);
  setTimeout(() => void runJobsOnce(), 3_000);
}

await app.listen({ port: cfg.PORT, host: "0.0.0.0" });
app.log.info(`Backstop backend on :${cfg.PORT} | hedge mode ${cfg.HEDGE_MODE} | contract ${backstopAddress}`);
