// Authenticated Gemini Prediction Markets client, built on the official SDK
// (@gemini-markets/sdk), which handles HMAC-SHA384 signing, payload encoding and nonces.
import { createClient, HmacAuth } from "@gemini-markets/sdk/server";
import { cfg } from "../config.js";

export type GeminiEnv = "production" | "sandbox";

export type OrderSnapshot = {
  orderId: string;
  status: string; // open | filled | cancelled
  filledQuantity: number;
  remainingQuantity: number;
  avgExecutionPrice: number | null;
  raw: unknown;
};

type AnyClient = Awaited<ReturnType<typeof createClient>>;
const clients = new Map<GeminiEnv, Promise<AnyClient>>();

export function hasCredentials() {
  return Boolean(cfg.GEMINI_API_KEY && cfg.GEMINI_API_SECRET);
}

function client(env: GeminiEnv): Promise<AnyClient> {
  if (!hasCredentials()) throw new Error("GEMINI_API_KEY / GEMINI_API_SECRET are not set");
  let c = clients.get(env);
  if (!c) {
    c = createClient({
      env,
      auth: new HmacAuth({
        apiKey: cfg.GEMINI_API_KEY!,
        apiSecret: cfg.GEMINI_API_SECRET!,
        nonceMode: "time-based",
      }),
      skipWsInit: true,
    });
    clients.set(env, c);
  }
  return c;
}

// The SDK's generated types are precise but very deep; this module exposes a small, stable surface.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pm = async (env: GeminiEnv): Promise<any> => (await client(env)).predictions;

const num = (v: unknown) => (v == null || v === "" ? 0 : Number(v));

function snapshot(o: Record<string, unknown>): OrderSnapshot {
  return {
    orderId: String(o.orderId),
    status: String(o.status),
    filledQuantity: num(o.filledQuantity),
    remainingQuantity: num(o.remainingQuantity),
    avgExecutionPrice: o.avgExecutionPrice == null ? null : Number(o.avgExecutionPrice),
    raw: JSON.parse(JSON.stringify(o, (_k, v) => (typeof v === "bigint" ? v.toString() : v))),
  };
}

export async function termsStatus(env: GeminiEnv) {
  return (await pm(env)).getPredictionMarketsTermsStatus() as Promise<{
    hasAcceptedLatest: boolean;
    acceptedVersion?: number;
    latestVersion?: number;
  }>;
}

export async function acceptTerms(env: GeminiEnv) {
  return (await pm(env)).acceptPredictionMarketsTerms();
}

export async function ensureTerms(env: GeminiEnv) {
  const s = await termsStatus(env);
  if (!s.hasAcceptedLatest) await acceptTerms(env);
}

export async function placeLimitBuy(
  env: GeminiEnv,
  args: {
    symbol: string;
    outcome: "yes" | "no";
    quantity: string;
    price: string;
    timeInForce: "fill-or-kill" | "immediate-or-cancel" | "good-til-cancel";
  },
): Promise<OrderSnapshot> {
  const o = await (await pm(env)).placeOrder({
    symbol: args.symbol,
    orderType: "limit",
    side: "buy",
    outcome: args.outcome,
    quantity: args.quantity,
    price: args.price,
    timeInForce: args.timeInForce,
    makerOrCancel: false,
  });
  return snapshot(o);
}

export async function cancelOrder(env: GeminiEnv, orderId: string) {
  return (await pm(env)).cancelOrder({ orderId: BigInt(orderId) });
}

/** Find an order by id: active orders first, then history. */
export async function getOrder(env: GeminiEnv, orderId: string, symbol?: string): Promise<OrderSnapshot | undefined> {
  const p = await pm(env);
  const active = await p.getActiveOrders(symbol ? { symbol, limit: 100 } : { limit: 100 });
  const hit = (active?.orders ?? []).find((o: { orderId: unknown }) => String(o.orderId) === orderId);
  if (hit) return snapshot(hit);
  const hist = await p.getOrderHistory({ limit: 100 });
  const h = (hist?.orders ?? []).find((o: { orderId: unknown }) => String(o.orderId) === orderId);
  return h ? snapshot(h) : undefined;
}

export async function getPositions(env: GeminiEnv) {
  return (await pm(env)).getPositions();
}

export async function getSettledPositions(env: GeminiEnv, eventTicker?: string) {
  return (await pm(env)).getSettledPositions(eventTicker ? { eventTicker } : {});
}
