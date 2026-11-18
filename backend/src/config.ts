import { config as loadEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const here = dirname(fileURLToPath(import.meta.url));
// Load the monorepo root .env (backend/.env would also work if present).
loadEnv({ path: resolve(here, "../../.env"), quiet: true });
loadEnv({ path: resolve(here, "../.env"), quiet: true });

const hex = z.string().regex(/^0x[0-9a-fA-F]+$/);
const optionalKey = z.preprocess((v) => (v === "" ? undefined : v), hex.optional());
const optionalStr = z.preprocess((v) => (v === "" ? undefined : v), z.string().optional());

const schema = z.object({
  ARC_RPC_URL: z.string().url().default("https://rpc.testnet.arc.io"),
  ARC_CHAIN_ID: z.coerce.number().default(5042002),
  ARC_EXPLORER_URL: z.string().url().default("https://explorer.testnet.arc.io"),
  USDC_ADDRESS: hex,
  BACKSTOP_ADDRESS: hex,
  BACKSTOP_DEPLOY_BLOCK: z.coerce.bigint().optional(),

  PRIVATE_KEY_SIGNER: hex,
  PRIVATE_KEY_RESOLVER: hex,

  GEMINI_PUBLIC_URL: z.string().url().default("https://api.gemini.com"),
  GEMINI_BASE_URL: z.string().url().default("https://api.gemini.com"),
  GEMINI_API_KEY: optionalStr,
  GEMINI_API_SECRET: optionalStr,

  HEDGE_MODE: z.enum(["simulated", "sandbox", "live"]).default("simulated"),
  MAX_LIVE_CONTRACTS: z.coerce.number().positive().default(5),
  HEDGE_TIME_IN_FORCE: z.enum(["fill-or-kill", "immediate-or-cancel", "good-til-cancel"]).default("fill-or-kill"),
  HEDGE_FILL_TIMEOUT_MS: z.coerce.number().default(20_000),
  /** simulated mode only: force every hedge to fail, to demo the refund path */
  SIMULATE_HEDGE_FAILURE: z.preprocess((v) => v === "true" || v === "1", z.boolean()).default(false),

  SPREAD: z.coerce.number().min(0).max(0.5).default(0.03),
  MAX_SLIPPAGE: z.coerce.number().min(0).max(0.5).default(0.02),
  QUOTE_TTL_SECONDS: z.coerce.number().default(60),
  /** refuse quotes on markets closing sooner than this (hedge needs time to fill) */
  MIN_SECONDS_TO_EXPIRY: z.coerce.number().default(45),
  /** resolveBy = market expiry + this buffer */
  RESOLVE_BUFFER_SECONDS: z.coerce.number().default(15 * 60),

  PORT: z.coerce.number().default(8787),
  DB_PATH: z.string().default(resolve(here, "../data/backstop.db")),
  POLL_INTERVAL_MS: z.coerce.number().default(3_000),
  RESOLVER_INTERVAL_MS: z.coerce.number().default(10_000),
  RUN_WORKERS: z.preprocess((v) => v !== "false" && v !== "0", z.boolean()).default(true),

  /** optional: enables POST /assist (Grok suggests a policy; the buyer still signs) */
  GROK_API_KEY: optionalStr,
  GROK_MODEL: z.string().default("grok-4.20-0309-non-reasoning"),
  /** optional: a testnet wallet the Grok agent buys cover from, on its own */
  PRIVATE_KEY_AGENT: optionalKey,
  AGENT_ENABLED: z.preprocess((v) => v === "true" || v === "1", z.boolean()).default(false),
  /** caps: per policy payout (whole USDC) and total premium the agent may spend per UTC day */
  AGENT_MAX_PAYOUT: z.coerce.number().int().positive().default(3),
  AGENT_DAILY_BUDGET_USDC: z.coerce.number().positive().default(5),

  /** development only: serve sample markets when Gemini's public API is down. Refused in production. */
  MOCK_MARKETS: z.preprocess((v) => v === "true" || v === "1", z.boolean()).default(false),
  /** how often the agent's market screener and watches run */
  SCREENER_INTERVAL_MS: z.coerce.number().default(30_000),
  /** Grok autopilot acts on screener findings under a standing mandate (can be toggled at runtime) */
  AUTOPILOT_DEFAULT_ON: z.preprocess((v) => v !== "false" && v !== "0", z.boolean()).default(true),

  // unused by the backend, accepted so a shared .env validates
  PRIVATE_KEY_DEPLOYER: optionalKey,
});

export const cfg = schema.parse(process.env);
if (cfg.MOCK_MARKETS && process.env.NODE_ENV === "production") {
  throw new Error("MOCK_MARKETS is for local development only and can't run in production");
}
export type Config = typeof cfg;
