// Grok agent: takes a plain-English instruction, lets Grok choose a policy, and buys it on Arc
// from its own testnet wallet, with no human signature. Bounded by AGENT_* caps and logged.
import { createWalletClient, erc20Abi, http, parseEventLogs, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { suggestCover } from "./assist.js";
import { arcTestnet, backstopAbi, backstopAddress, publicClient, txUrl, USDC_UNIT, usdcAddress } from "./chain.js";
import { cfg } from "./config.js";
import { db, now } from "./db.js";
import { formatUsdc, makeQuote, QuoteError } from "./quotes.js";

const account = cfg.PRIVATE_KEY_AGENT ? privateKeyToAccount(cfg.PRIVATE_KEY_AGENT as Hex) : undefined;
const wallet = account ? createWalletClient({ account, chain: arcTestnet, transport: http(cfg.ARC_RPC_URL) }) : undefined;

export const agentAddress = account?.address;
export const agentEnabled = () => !!(cfg.AGENT_ENABLED && account && cfg.GROK_API_KEY);

export type AgentActionRow = {
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
};

const startOfUtcDay = () => Math.floor(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()) / 1000);

function spentToday(): bigint {
  const rows = db
    .prepare("SELECT premium FROM agent_actions WHERE status = 'bought' AND at >= ?")
    .all(startOfUtcDay()) as { premium: string }[];
  return rows.reduce((s, r) => s + BigInt(r.premium), 0n);
}

const budget = () => BigInt(Math.round(cfg.AGENT_DAILY_BUDGET_USDC * 1_000_000));

export async function agentStatus() {
  const balance = agentAddress
    ? await publicClient.readContract({ address: usdcAddress, abi: erc20Abi, functionName: "balanceOf", args: [agentAddress] })
    : 0n;
  const spent = spentToday();
  const actions = db.prepare("SELECT * FROM agent_actions ORDER BY id DESC LIMIT 20").all() as AgentActionRow[];
  return {
    enabled: agentEnabled(),
    address: agentAddress ?? null,
    balanceUsdc: formatUsdc(balance),
    maxPayoutUsdc: cfg.AGENT_MAX_PAYOUT,
    dailyBudgetUsdc: formatUsdc(budget()),
    spentTodayUsdc: formatUsdc(spent),
    model: cfg.GROK_MODEL,
    actions: actions.map((a) => ({
      id: a.id,
      at: a.at,
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
      `INSERT INTO agent_actions (at, instruction, summary, reasoning, instrument_symbol, outcome, payout, premium, policy_id, tx, status, error, model)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    );
  return Number(r.lastInsertRowid);
}

// one purchase at a time, so the agent wallet's nonces never collide
let chain: Promise<unknown> = Promise.resolve();
export function runAgent(instruction: string) {
  const job = chain.then(() => run(instruction));
  chain = job.catch(() => undefined);
  return job;
}

async function run(instruction: string) {
  if (!agentEnabled() || !account || !wallet) throw new QuoteError("The Grok agent is switched off on this server.", "agent_off", 503);

  // 1. Grok decides.
  const s = await suggestCover(instruction);
  const base = { instruction, summary: s.summary, reasoning: s.reasoning, model: s.model };
  if (!s.instrumentSymbol || !s.outcome || !s.market) {
    const id = record({ ...base, instrument_symbol: null, outcome: null, payout: null, premium: null, policy_id: null, tx: null, status: "declined", error: null });
    return { id, status: "declined" as const, ...base };
  }
  const payout = Math.min(s.payout ?? 1, cfg.AGENT_MAX_PAYOUT);
  const pick = { instrument_symbol: s.instrumentSymbol, outcome: s.outcome, payout };

  try {
    // 2. Price it with the same signed quote a human gets.
    const q = await makeQuote({
      buyer: account.address,
      instrumentSymbol: s.instrumentSymbol,
      eventTicker: s.market.eventTicker,
      outcome: s.outcome,
      payout,
    });
    const premium = BigInt(q.quote.premium);

    // 3. Guardrails: daily budget and wallet balance (gas is USDC too, so keep a little back).
    const spent = spentToday();
    if (spent + premium > budget()) {
      const error = `Daily budget reached: ${formatUsdc(spent)} of ${formatUsdc(budget())} USDC spent today, this policy costs ${formatUsdc(premium)}.`;
      const id = record({ ...base, ...pick, premium: premium.toString(), policy_id: null, tx: null, status: "blocked", error });
      return { id, status: "blocked" as const, error, ...base };
    }
    const balance = await publicClient.readContract({ address: usdcAddress, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
    if (balance < premium + USDC_UNIT / 20n) {
      const error = `Agent wallet has ${formatUsdc(balance)} USDC, not enough for a ${formatUsdc(premium)} USDC premium plus gas.`;
      const id = record({ ...base, ...pick, premium: premium.toString(), policy_id: null, tx: null, status: "blocked", error });
      return { id, status: "blocked" as const, error, ...base };
    }

    // 4. Approve (if needed) and buy, signed by the agent wallet.
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

    const id = record({ ...base, ...pick, premium: premium.toString(), policy_id: policyId, tx, status: "bought", error: null });
    return { id, status: "bought" as const, policyId, tx, url: txUrl(tx), premiumUsdc: formatUsdc(premium), payout, ...base };
  } catch (e) {
    const error = e instanceof QuoteError ? e.message : ((e as { shortMessage?: string }).shortMessage ?? (e as Error).message);
    const id = record({ ...base, ...pick, premium: null, policy_id: null, tx: null, status: "failed", error });
    return { id, status: "failed" as const, error, ...base };
  }
}
