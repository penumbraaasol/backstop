// For each new policy, buy `payout` contracts of the covered outcome on Gemini.
// If the hedge can't be filled, cancel the policy onchain and refund the premium.
import { cfg } from "./config.js";
import { outcomeName, resolverWrite } from "./chain.js";
import { db, now, type PolicyRow } from "./db.js";
import { askFor, getContract, venueCanHedge } from "./gemini/public.js";
import { makeVenue, priceStr, simulatedVenue, type HedgeVenue } from "./hedge/venue.js";

const log = (...a: unknown[]) => console.log("[hedger]", ...a);
const inFlight = new Set<number>();
let venue: HedgeVenue | undefined;
export const hedgeVenue = () => (venue ??= makeVenue());

let simulated: HedgeVenue | undefined;

export async function hedgePolicy(p: PolicyRow) {
  const outcome = outcomeName(p.outcome);
  const quantity = Number(BigInt(p.payout) / 1_000_000n);

  let quoted = p.quoted_price != null ? Number(p.quoted_price) : undefined;
  if (quoted == null) {
    const { contract } = await getContract(p.instrument_symbol, p.event_ticker);
    quoted = askFor(contract, outcome) ?? 0.99;
  }
  // sandbox mode: markets the sandbox doesn't list, or can't fill near the quote, hedge on the simulated venue
  const sim = () => (simulated ??= simulatedVenue());
  let v = hedgeVenue();
  if (cfg.HEDGE_MODE === "sandbox") {
    const check = await venueCanHedge(p.instrument_symbol, outcome, quoted, p.event_ticker).catch(() => ({ via: "simulated" }));
    if (check.via === "simulated") v = sim();
  }
  const limitPrice = Math.min(0.99, quoted + cfg.MAX_SLIPPAGE);
  log(`policy #${p.policy_id}: buy ${quantity} ${outcome.toUpperCase()} ${p.instrument_symbol} @ <= ${priceStr(limitPrice)} [${v.mode}]`);

  let result;
  try {
    result = await v.hedge({ symbol: p.instrument_symbol, eventTicker: p.event_ticker, outcome, quantity, limitPrice });
  } catch (e) {
    result = { ok: false as const, reason: `hedge error: ${(e as Error).message}` };
  }
  // sandbox order didn't fill (the book moved): hedge on the simulated venue rather than refund the buyer
  if (!result.ok && cfg.HEDGE_MODE === "sandbox" && v.mode !== "simulated" && !cfg.SIMULATE_HEDGE_FAILURE) {
    log(`policy #${p.policy_id}: sandbox didn't fill (${result.reason}); hedging on the simulated venue`);
    v = sim();
    result = await v.hedge({ symbol: p.instrument_symbol, eventTicker: p.event_ticker, outcome, quantity, limitPrice });
  }

  if (result.ok) {
    db.prepare(
      `UPDATE policies SET hedge_status = ?, hedge_mode = ?, hedge_order_id = ?, hedge_fill_price = ?, hedge_filled_qty = ?,
         hedge_error = ?, hedge_at = ? WHERE policy_id = ?`,
    ).run(
      result.partial ? "partial" : "filled",
      v.mode,
      result.orderId,
      String(result.avgPrice),
      String(result.filledQuantity),
      result.partial ? `partial fill ${result.filledQuantity}/${quantity}` : null,
      now(),
      p.policy_id,
    );
    log(`policy #${p.policy_id}: hedged ${result.filledQuantity} @ ${result.avgPrice} (order ${result.orderId})`);
    return;
  }

  log(`policy #${p.policy_id}: hedge failed (${result.reason}); refunding premium onchain`);
  db.prepare(
    "UPDATE policies SET hedge_status = 'failed', hedge_mode = ?, hedge_order_id = ?, hedge_error = ?, hedge_at = ? WHERE policy_id = ?",
  ).run(v.mode, result.orderId ?? null, result.reason, now(), p.policy_id);
  try {
    const tx = await resolverWrite("cancelAndRefund", [BigInt(p.policy_id)]);
    db.prepare("UPDATE policies SET status = 'refunded', refund_tx = ? WHERE policy_id = ?").run(tx, p.policy_id);
    log(`policy #${p.policy_id}: refunded in ${tx}`);
  } catch (e) {
    log(`policy #${p.policy_id}: cancelAndRefund failed: ${(e as Error).message}`);
  }
}

export async function hedgePending() {
  const rows = db
    .prepare("SELECT * FROM policies WHERE status = 'active' AND hedge_status = 'pending' ORDER BY policy_id")
    .all() as PolicyRow[];
  for (const p of rows) {
    if (inFlight.has(p.policy_id)) continue;
    inFlight.add(p.policy_id);
    try {
      await hedgePolicy(p);
    } finally {
      inFlight.delete(p.policy_id);
    }
  }
}
