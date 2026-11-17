// Polls Backstop events from Arc and mirrors them into SQLite. Every policy, including ones
// settled or refunded by other callers, ends up with the right status.
import { parseEventLogs, type Log } from "viem";
import { cfg } from "./config.js";
import { backstopAbi, backstopAddress, publicClient } from "./chain.js";
import { db, kvGet, kvSet, now, type QuoteRow } from "./db.js";

const CURSOR = "indexer:lastBlock";
const MAX_RANGE = 5_000n;
const log = (...a: unknown[]) => console.log("[indexer]", ...a);

async function startBlock(): Promise<bigint> {
  const c = kvGet(CURSOR);
  if (c) return BigInt(c) + 1n;
  if (cfg.BACKSTOP_DEPLOY_BLOCK != null) return cfg.BACKSTOP_DEPLOY_BLOCK;
  return (await publicClient.getBlockNumber()) - 1_000n;
}

function onPurchased(l: { args: Record<string, unknown>; transactionHash: string; blockNumber: bigint }) {
  const a = l.args as {
    policyId: bigint;
    buyer: string;
    marketId: string;
    instrumentSymbol: string;
    outcome: number;
    payout: bigint;
    premium: bigint;
  };
  const id = Number(a.policyId);
  if (db.prepare("SELECT 1 FROM policies WHERE policy_id = ?").get(id)) return;

  // Match the signed quote to recover the quoted price and market metadata.
  const q = db
    .prepare(
      `SELECT * FROM quotes WHERE buyer = ? AND market_id = ? AND outcome = ? AND payout = ? AND premium = ?
       AND policy_id IS NULL ORDER BY created_at DESC LIMIT 1`,
    )
    .get(a.buyer.toLowerCase(), a.marketId, a.outcome, a.payout.toString(), a.premium.toString()) as QuoteRow | undefined;
  if (q) db.prepare("UPDATE quotes SET policy_id = ? WHERE nonce = ?").run(id, q.nonce);

  const eventTicker = q?.event_ticker ?? /^GEMI-(.+)-[^-]+$/.exec(a.instrumentSymbol)?.[1] ?? a.instrumentSymbol;
  db.prepare(
    `INSERT INTO policies(policy_id, buyer, instrument_symbol, event_ticker, market_title, market_id, outcome, payout, premium,
       quoted_price, resolve_by, market_expiry, status, purchase_tx, purchase_block, created_at, hedge_status)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?, 'active', ?, ?, ?, 'pending')`,
  ).run(
    id,
    a.buyer.toLowerCase(),
    a.instrumentSymbol,
    eventTicker,
    q?.market_title ?? null,
    a.marketId,
    a.outcome,
    a.payout.toString(),
    a.premium.toString(),
    q?.price ?? null,
    q?.resolve_by ?? 0,
    q?.market_expiry ?? null,
    l.transactionHash,
    Number(l.blockNumber),
    now(),
  );
  db.prepare(
    "INSERT INTO markets(market_id, instrument_symbol, event_ticker) VALUES(?,?,?) ON CONFLICT(market_id) DO NOTHING",
  ).run(a.marketId, a.instrumentSymbol, eventTicker);
  log(`policy #${id} purchased by ${a.buyer} on ${a.instrumentSymbol} (${a.outcome === 1 ? "YES" : "NO"})`);
}

export async function indexOnce() {
  const head = await publicClient.getBlockNumber();
  let from = await startBlock();
  while (from <= head) {
    const to = from + MAX_RANGE - 1n < head ? from + MAX_RANGE - 1n : head;
    const raw = await publicClient.getLogs({ address: backstopAddress, fromBlock: from, toBlock: to });
    const logs = parseEventLogs({ abi: backstopAbi, logs: raw as Log[] });
    for (const l of logs) {
      const args = l.args as Record<string, unknown>;
      switch (l.eventName) {
        case "PolicyPurchased":
          // resolveBy is not in the event; read it from chain if no quote matched
          onPurchased(l as never);
          if (!(db.prepare("SELECT resolve_by FROM policies WHERE policy_id = ?").get(Number(args.policyId)) as { resolve_by: number })?.resolve_by) {
            const p = (await publicClient.readContract({
              address: backstopAddress,
              abi: backstopAbi,
              functionName: "getPolicy",
              args: [args.policyId as bigint],
            })) as { resolveBy: bigint };
            db.prepare("UPDATE policies SET resolve_by = ? WHERE policy_id = ?").run(Number(p.resolveBy), Number(args.policyId));
          }
          break;
        case "PolicySettled":
          db.prepare("UPDATE policies SET status = ?, settle_tx = ?, settled_at = ? WHERE policy_id = ?").run(
            args.paid ? "paid_out" : "expired",
            l.transactionHash,
            now(),
            Number(args.policyId),
          );
          break;
        case "PolicyCancelled":
        case "RefundClaimed":
          db.prepare("UPDATE policies SET status = 'refunded', refund_tx = ? WHERE policy_id = ?").run(
            l.transactionHash,
            Number(args.policyId),
          );
          break;
        case "MarketResolved":
          db.prepare("UPDATE markets SET result = ?, resolve_tx = ?, resolved_at = ? WHERE market_id = ?").run(
            Number(args.result),
            l.transactionHash,
            now(),
            args.marketId as string,
          );
          break;
      }
    }
    kvSet(CURSOR, to.toString());
    from = to + 1n;
  }
}
