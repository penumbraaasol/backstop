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
  asset?: string;
  assetName?: string;
  series: string | null;
  kind: "5m" | "15m" | "other";
  startTime: string | null;
  expiry: string;
  secondsToExpiry: number;
  strike: string | null;
  askYes: number;
  askNo: number;
  /** whether the backend can hedge each side on its Gemini venue right now */
  hedgeable?: { yes: boolean; no: boolean };
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
  assistant?: boolean;
  /** agent wallet address when the Grok agent is switched on */
  agent?: `0x${string}` | null;
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

export type Suggestion = {
  instrumentSymbol: string | null;
  outcome: Outcome | null;
  payout: number | null;
  summary: string;
  reasoning: string;
  market?: Market;
  model: string;
};

export type AgentAction = {
  id: number;
  at: number;
  instruction: string;
  summary: string;
  reasoning: string;
  instrumentSymbol: string | null;
  outcome: Outcome | null;
  payout: number | null;
  premiumUsdc: string | null;
  policyId: number | null;
  tx: string | null;
  url: string | null;
  status: "bought" | "declined" | "blocked" | "failed";
  error: string | null;
  model: string;
};

export type AgentStatus = {
  enabled: boolean;
  address: `0x${string}` | null;
  balanceUsdc: string;
  maxPayoutUsdc: number;
  dailyBudgetUsdc: string;
  spentTodayUsdc: string;
  model: string;
  screenerIntervalSec?: number;
  sampleMarkets?: boolean;
  actions: AgentAction[];
};

export type ChatStep = { tool: string; label: string; ok: boolean; detail?: string; url?: string; policyId?: number };
export type ChatMessage = { role: "user" | "assistant"; content: string; steps?: ChatStep[] };

export type AgentEvent = {
  id: number;
  at: number;
  kind: "scan" | "finding" | "onchain" | "action" | "watch" | "error" | "decision";
  title: string;
  detail: string | null;
  instrumentSymbol: string | null;
  policyId: number | null;
  tx: string | null;
  url: string | null;
};

type JobStat = { lastRunAt: number | null; lastMs: number | null; lastError: string | null; runs: number };
export type AgentWatch = {
  id: number;
  asset: string;
  outcome: Outcome;
  horizon: string;
  payout: number;
  maxPrice: number;
  note: string;
  createdAt: number;
  lastRun: number | null;
  lastResult: string | null;
};
export type Autopilot = {
  enabled: boolean;
  mandate: string;
  holdings: { asset: string; amount: number; spot: number | null; valueUsd: number | null }[];
  rules: { minDistance: number; maxDistance: number; minCost: number; maxCost: number; hedgeMove: number; maxSizeMultiple: number };
  lastDecisionAt: number | null;
  lastReviewAt: number | null;
  reviewEverySec: number;
  model: string;
};

export type AgentActivity = {
  jobs: {
    intervalSec: number;
    autopilot: Autopilot;
    screener: JobStat & { marketsScanned: number; findings: number };
    onchain: JobStat & { policiesTracked: number; freeLiquidityUsdc: string | null };
    watches: JobStat & { list: AgentWatch[] };
  };
  events: AgentEvent[];
};

export type AgentRun = {
  id: number;
  status: AgentAction["status"];
  summary: string;
  reasoning: string;
  policyId?: number;
  tx?: string;
  url?: string;
  premiumUsdc?: string;
  payout?: number;
  error?: string;
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
  markets: () => call<{ markets: Market[] }>("/markets?category=all&perSeries=3").then((r) => r.markets),
  policies: (address: string) => call<{ policies: PolicyTimeline[] }>(`/policies/${address}`).then((r) => r.policies),
  assist: (message: string) =>
    call<Suggestion>("/assist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message }),
    }),
  agent: () => call<AgentStatus>("/agent"),
  activity: () => call<AgentActivity>("/agent/activity"),
  chat: (messages: ChatMessage[]) =>
    call<{ reply: string; steps: ChatStep[]; model: string }>("/agent/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: messages.map(({ role, content }) => ({ role, content })) }),
    }),
  setAutopilot: (body: { enabled?: boolean; mandate?: string }) =>
    call<Autopilot>("/agent/autopilot", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  stopWatch: (id: number) => call<{ stopped: boolean }>(`/agent/watches/${id}/stop`, { method: "POST" }),
  runAgent: (message: string) =>
    call<AgentRun>("/agent/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message }),
    }),
  quote: (body: { buyer: string; instrumentSymbol: string; eventTicker?: string; outcome: Outcome; payout: number }) =>
    call<SignedQuote>("/quote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
};
