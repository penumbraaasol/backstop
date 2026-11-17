// Typed client for the Backstop backend (backend/src/server.ts).
export const API = (process.env.NEXT_PUBLIC_BACKSTOP_API ?? "http://localhost:8787").replace(/\/$/, "");

export type Outcome = "yes" | "no";

export type Market = {
  instrumentSymbol: string;
  eventTicker: string;
  title: string;
  label: string;
  question: string;
  category: string;
  series: string | null;
  kind: "5m" | "15m" | "other";
  startTime: string | null;
  expiry: string;
  secondsToExpiry: number;
  strike: string | null;
  askYes: number;
  askNo: number;
  imageUrl: string | null;
  termsLink: string | null;
};

export type BackendConfig = {
  chainId: number;
  rpcUrl: string;
  explorerUrl: string;
  backstopAddress: `0x${string}`;
  usdcAddress: `0x${string}`;
  quoteSigner: `0x${string}`;
  resolver: `0x${string}`;
  hedgeMode: "simulated" | "sandbox" | "live";
  spread: number;
  maxSlippage: number;
};

export type Stats = {
  freeLiquidityUsdc: string;
  lockedLiquidityUsdc: string;
  maxPayoutUsdc: string;
  maxExposurePerMarketUsdc: string;
};

export type SignedQuote = {
  instrumentSymbol: string;
  contractAddress: `0x${string}`;
  chainId: number;
  signature: `0x${string}`;
  quote: {
    buyer: `0x${string}`;
    marketId: `0x${string}`;
    outcome: number | string;
    payout: string;
    premium: string;
    quoteExpiry: string;
    resolveBy: string;
    nonce: string;
  };
  breakdown: {
    payoutUsdc: string;
    price: number;
    spread: number;
    premiumUsdc: string;
    hedgeCostUsdc: string;
    marginUsdc: string;
    formula: string;
  };
  market: Market;
};

export type PolicyStatus = "active" | "paid_out" | "expired" | "refunded";

export type PolicyTimeline = {
  policyId: number;
  buyer: string;
  instrumentSymbol: string;
  eventTicker: string | null;
  marketTitle: string | null;
  marketExpiry: string | null;
  outcome: Outcome;
  payoutUsdc: string;
  premiumUsdc: string;
  quotedPrice: number | null;
  resolveBy: number;
  status: PolicyStatus;
  steps: {
    purchased: { done: true; tx: string; url: string };
    hedged: {
      status: "pending" | "filled" | "partial" | "failed";
      mode: string | null;
      orderId: string | null;
      fillPrice: string | null;
      filledQty: string | null;
      error: string | null;
      at: number | null;
    };
    resolved: { done: boolean; result?: Outcome; tx?: string; url?: string | null };
    settled: { done: boolean; paid?: boolean; refunded?: boolean; tx?: string; url?: string | null };
  };
};

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API + path, { cache: "no-store", ...init });
  } catch {
    throw new ApiError("offline", "Can't reach the Backstop backend.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error ?? "error", body.message ?? `Request failed (${res.status})`);
  return body as T;
}

export const api = {
  config: () => call<BackendConfig>("/config"),
  stats: () => call<Stats>("/stats"),
  markets: () => call<{ markets: Market[] }>("/markets?perSeries=3").then((r) => r.markets),
  policies: (address: string) => call<{ policies: PolicyTimeline[] }>(`/policies/${address}`).then((r) => r.policies),
  quote: (body: { buyer: string; instrumentSymbol: string; eventTicker?: string; outcome: Outcome; payout: number }) =>
    call<SignedQuote>("/quote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
};
