// Watches Gemini for resolution of markets with open policies, posts the result onchain,
// then settles every open policy in that market.
import { backstopAbi, backstopAddress, publicClient, resolverWrite } from "./chain.js";
import { db, now, type PolicyRow } from "./db.js";
import { getContract } from "./gemini/public.js";

const log = (...a: unknown[]) => console.log("[resolver]", ...a);
let running = false;

type OpenMarket = { market_id: `0x${string}`; instrument_symbol: string; event_ticker: string; market_expiry: string | null };

export async function resolveOnce() {
  if (running) return;
  running = true;
  try {
    const markets = db
      .prepare(
        `SELECT DISTINCT market_id, instrument_symbol, event_ticker, market_expiry FROM policies
         WHERE status = 'active' AND hedge_status != 'pending'`,
      )
      .all() as OpenMarket[];

    for (const m of markets) {
      if (m.market_expiry && new Date(m.market_expiry).getTime() > Date.now()) continue; // not expired yet
      try {
        await resolveMarket(m);
      } catch (e) {
        log(`${m.instrument_symbol}: ${(e as Error).message}`);
      }
    }
  } finally {
    running = false;
  }
}

async function resolveMarket(m: OpenMarket) {
  let result = Number(
    await publicClient.readContract({
      address: backstopAddress,
      abi: backstopAbi,
      functionName: "marketResult",
      args: [m.market_id],
    }),
  );

  if (result === 0) {
    const { contract } = await getContract(m.instrument_symbol, m.event_ticker);
    const side = contract.resolutionSide;
    if (side !== "yes" && side !== "no") return; // not resolved on Gemini yet (or voided: buyers can claimRefund after timeout)
    result = side === "yes" ? 1 : 2;
    const tx = await resolverWrite("resolveMarket", [m.market_id, result]);
    db.prepare("UPDATE markets SET result = ?, resolve_tx = ?, resolved_at = ? WHERE market_id = ?").run(result, tx, now(), m.market_id);
    log(`${m.instrument_symbol} resolved ${side.toUpperCase()} on Gemini; posted onchain ${tx}`);
  }

  const open = db
    .prepare("SELECT * FROM policies WHERE market_id = ? AND status = 'active' ORDER BY policy_id")
    .all(m.market_id) as PolicyRow[];
  for (const p of open) {
    const tx = await resolverWrite("settle", [BigInt(p.policy_id)]);
    const won = p.outcome === result;
    db.prepare("UPDATE policies SET status = ?, settle_tx = ?, settled_at = ? WHERE policy_id = ?").run(
      won ? "paid_out" : "expired",
      tx,
      now(),
      p.policy_id,
    );
    log(`policy #${p.policy_id} ${won ? "PAID OUT" : "expired"} in ${tx}`);
  }
}
