// Checks Gemini credentials and whether an environment accepts prediction-market orders.
// Usage: pnpm --filter @backstop/backend gemini:check [--env sandbox|production] [--order]
//   --order  places one tiny far-from-market limit buy (price 0.01, min quantity) and cancels it.
//            On production this needs explicit confirmation from the operator; it never fills
//            unless someone sells at $0.01, and it is cancelled immediately.
import { parseArgs } from "node:util";
import * as priv from "../src/gemini/private.js";
import { listEvents } from "../src/gemini/public.js";

const { values } = parseArgs({
  options: { env: { type: "string", default: "sandbox" }, order: { type: "boolean", default: false } },
});
const env = values.env as priv.GeminiEnv;
const show = (label: string, v: unknown) =>
  console.log(label, JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2));

console.log(`== Gemini ${env}`);
try {
  show("terms status:", await priv.termsStatus(env));
} catch (e) {
  console.log("terms status FAILED:", (e as Error).message);
}
try {
  show("positions:", await priv.getPositions(env));
} catch (e) {
  console.log("positions FAILED:", (e as Error).message);
}

if (values.order) {
  if (env === "production" && process.env.CONFIRM_LIVE_TEST !== "yes") {
    console.log("refusing to place a production order without CONFIRM_LIVE_TEST=yes");
    process.exit(1);
  }
  // Sandbox lists its own prediction events; pick a contract from the matching environment.
  const base = env === "sandbox" ? "https://api.sandbox.gemini.com" : "https://api.gemini.com";
  const res = await fetch(`${base}/v1/prediction-markets/events?status=active&category=crypto&limit=50`);
  const events = ((await res.json()) as { data: Awaited<ReturnType<typeof listEvents>> }).data;
  const target = events
    .flatMap((e) => e.contracts.map((c) => ({ e, c })))
    .find(
      ({ e, c }) =>
        c.status === "active" &&
        c.marketState === "open" &&
        new Date(e.startTime ?? 0).getTime() < Date.now() &&
        Object.keys(c.prices?.buy ?? {}).length > 0,
    );
  if (!target) throw new Error("no open contract found");
  // 0.01 contracts at $0.01 is rejected as InvalidInput; 1 contract at $0.01 is accepted.
  const qty = "1";
  console.log(`placing buy YES ${qty} ${target.c.instrumentSymbol} @ 0.01 (good-til-cancel)`);
  try {
    await priv.ensureTerms(env);
    const o = await priv.placeLimitBuy(env, {
      symbol: target.c.instrumentSymbol,
      outcome: "yes",
      quantity: qty,
      price: "0.01",
      timeInForce: "good-til-cancel",
    });
    show("order accepted:", o);
    show("cancel:", await priv.cancelOrder(env, o.orderId));
    show("final:", await priv.getOrder(env, o.orderId, target.c.instrumentSymbol));
    console.log(`RESULT: ${env} ACCEPTS prediction market orders`);
  } catch (e) {
    console.log(`RESULT: ${env} order FAILED: ${(e as Error).message}`);
    show("error detail:", e);
  }
}
process.exit(0);
