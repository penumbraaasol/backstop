// End-to-end loop against the deployed contract and a running backend:
//   quote -> approve -> buyPolicy -> hedge -> Gemini resolution -> onchain payout/expiry
//
// Usage: pnpm --filter @backstop/backend e2e [--outcome yes|no|auto] [--payout 2] [--asset BTC] [--api http://localhost:8787]
// Buyer key: PRIVATE_KEY_BUYER, falling back to PRIVATE_KEY_DEPLOYER.
import { config as loadEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createPublicClient, createWalletClient, defineChain, erc20Abi, http, parseEventLogs, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { backstopAbi } from "../src/abi.js";

const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, "../../.env"), quiet: true });

const { values: args } = parseArgs({
  options: {
    outcome: { type: "string", default: "yes" },
    payout: { type: "string", default: "2" },
    asset: { type: "string", default: "BTC" },
    api: { type: "string", default: process.env.BACKSTOP_API ?? "http://localhost:8787" },
    symbol: { type: "string" },
  },
});

const pk = (process.env.PRIVATE_KEY_BUYER || process.env.PRIVATE_KEY_DEPLOYER) as Hex;
if (!pk) throw new Error("set PRIVATE_KEY_BUYER or PRIVATE_KEY_DEPLOYER");
const account = privateKeyToAccount(pk);
const api = args.api!;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const say = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(api + path, init);
  const body = await res.json();
  if (!res.ok) throw new Error(`${path}: ${JSON.stringify(body)}`);
  return body as T;
}

type Cfg = { chainId: number; rpcUrl: string; explorerUrl: string; backstopAddress: Hex; usdcAddress: Hex; hedgeMode: string };
type Market = { instrumentSymbol: string; eventTicker: string; question: string; kind: string; secondsToExpiry: number; askYes: number; askNo: number };

const conf = await getJson<Cfg>("/config");
const chain = defineChain({
  id: conf.chainId,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [conf.rpcUrl] } },
});
const pub = createPublicClient({ chain, transport: http(conf.rpcUrl) });
const wallet = createWalletClient({ account, chain, transport: http(conf.rpcUrl) });
const usdcBal = async () => (await pub.readContract({ address: conf.usdcAddress, abi: erc20Abi, functionName: "balanceOf", args: [account.address] })) as bigint;
const fmt = (b: bigint) => (Number(b) / 1e6).toFixed(6);

say(`buyer ${account.address} | hedge mode ${conf.hedgeMode} | USDC ${fmt(await usdcBal())}`);

// 1. Pick a market: the soonest short-expiry market for the asset with enough time to hedge.
const { markets } = await getJson<{ markets: Market[] }>("/markets?perSeries=3");
const market =
  (args.symbol && markets.find((m) => m.instrumentSymbol === args.symbol)) ||
  markets.find((m) => m.instrumentSymbol.startsWith(`GEMI-${args.asset}05M`) && m.secondsToExpiry >= 75) ||
  markets.find((m) => m.instrumentSymbol.startsWith(`GEMI-${args.asset}`) && m.secondsToExpiry >= 75);
if (!market) throw new Error(`no suitable ${args.asset} market right now`);
if (args.outcome === "auto") args.outcome = market.askYes <= market.askNo ? "yes" : "no";
say(`market ${market.instrumentSymbol}: "${market.question}" closes in ${market.secondsToExpiry}s (ask YES ${market.askYes} / NO ${market.askNo})`);

// 2. Quote.
const q = await getJson<{
  signature: Hex;
  instrumentSymbol: string;
  quote: Record<string, string | number>;
  breakdown: { formula: string; premiumUsdc: string; hedgeCostUsdc: string; marginUsdc: string };
}>("/quote", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    buyer: account.address,
    instrumentSymbol: market.instrumentSymbol,
    eventTicker: market.eventTicker,
    outcome: args.outcome,
    payout: Number(args.payout),
  }),
});
say(`quote: cover ${String(args.outcome).toUpperCase()}, premium ${q.breakdown.formula} (hedge ${q.breakdown.hedgeCostUsdc} + margin ${q.breakdown.marginUsdc})`);

const quoteTuple = {
  buyer: q.quote.buyer as Hex,
  marketId: q.quote.marketId as Hex,
  outcome: Number(q.quote.outcome),
  payout: BigInt(q.quote.payout),
  premium: BigInt(q.quote.premium),
  quoteExpiry: BigInt(q.quote.quoteExpiry),
  resolveBy: BigInt(q.quote.resolveBy),
  nonce: BigInt(q.quote.nonce),
};

// 3. Approve + buy.
const allowance = (await pub.readContract({
  address: conf.usdcAddress,
  abi: erc20Abi,
  functionName: "allowance",
  args: [account.address, conf.backstopAddress],
})) as bigint;
if (allowance < quoteTuple.premium) {
  const h = await wallet.writeContract({ address: conf.usdcAddress, abi: erc20Abi, functionName: "approve", args: [conf.backstopAddress, quoteTuple.premium] });
  await pub.waitForTransactionReceipt({ hash: h });
  say(`approved ${fmt(quoteTuple.premium)} USDC: ${conf.explorerUrl}/tx/${h}`);
}
const before = await usdcBal();
const { request } = await pub.simulateContract({
  account,
  address: conf.backstopAddress,
  abi: backstopAbi,
  functionName: "buyPolicy",
  args: [quoteTuple, q.signature, q.instrumentSymbol],
});
const buyHash = await wallet.writeContract(request);
const receipt = await pub.waitForTransactionReceipt({ hash: buyHash });
const [purchased] = parseEventLogs({ abi: backstopAbi, logs: receipt.logs, eventName: "PolicyPurchased" });
const policyId = Number(purchased!.args.policyId);
say(`bought policy #${policyId}: ${conf.explorerUrl}/tx/${buyHash}`);

// 4. Follow the policy through hedge -> resolution -> settlement.
type Timeline = {
  status: string;
  steps: {
    hedged: { status: string; orderId?: string; fillPrice?: string; error?: string; mode?: string };
    resolved: { done: boolean; result?: string; url?: string };
    settled: { done: boolean; paid?: boolean; refunded?: boolean; url?: string };
  };
};
let last = "";
const deadline = Date.now() + (market.secondsToExpiry + 5 * 60) * 1000;
while (Date.now() < deadline) {
  const t = await getJson<Timeline>(`/policy/${policyId}`).catch(() => undefined);
  if (t) {
    const h = t.steps.hedged;
    const line = `status=${t.status} hedge=${h.status}${h.fillPrice ? `@${h.fillPrice}` : ""}${h.error ? ` (${h.error})` : ""} resolved=${t.steps.resolved.result ?? "-"}`;
    if (line !== last) say(line), (last = line);
    if (t.steps.settled.done) {
      const s = t.steps.settled;
      say(s.refunded ? `REFUNDED: ${s.url}` : s.paid ? `PAID OUT: ${s.url}` : `EXPIRED (covered outcome did not happen): ${s.url}`);
      break;
    }
  }
  await sleep(4_000);
}
const after = await usdcBal();
say(`USDC before buy ${fmt(before)} -> now ${fmt(after)} (net ${fmt(after - before)})`);
