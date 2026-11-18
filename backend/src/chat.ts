// Chat with the Grok Bot. Grok can call tools: screen live markets, read its on-chain status,
// buy cover from its own wallet, and start or stop standing watches. Every tool call is returned
// as a visible step, and purchases go through buyCover() with the same limits as everywhere else.
import { z } from "zod";
import {
  agentAddress,
  agentBalance,
  agentEnabled,
  buyCover,
  createWatch,
  dailyBudget,
  listWatches,
  marketsForAgent,
  recentEvents,
  spentToday,
  stopWatch,
} from "./agent.js";
import { cfg } from "./config.js";
import { db } from "./db.js";
import type { MarketView } from "./markets.js";
import { formatUsdc, QuoteError } from "./quotes.js";
import { autopilotState, setAutopilot } from "./autopilot.js";

export type Step = { tool: string; label: string; ok: boolean; detail?: string; url?: string; policyId?: number };

const assetOf = (s: string) => /^GEMI-([A-Z]+?)(?:05M|15M|1H|\d)/.exec(s)?.[1] ?? "";
const horizonOf = (m: MarketView) => (m.kind === "5m" ? "5m" : m.kind === "15m" ? "15m" : /1H$/.test(m.series ?? "") ? "1h" : "later");

const TOOLS = [
  {
    type: "function",
    function: {
      name: "screen_markets",
      description: "Read live Gemini prediction markets (prices are the best ask per 1 USDC payout). Filter by asset and horizon.",
      parameters: {
        type: "object",
        properties: {
          asset: { type: "string", description: "BTC, ETH, SOL, XRP, HYPE, ZEC. Omit for all." },
          horizon: { type: "string", enum: ["5m", "15m", "1h", "later"], description: "Market window length. Omit for all." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "agent_status",
      description: "Read the agent's wallet balance on Arc, today's spend vs budget, its open policies and their hedge/settlement state, and active watches.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "buy_cover",
      description:
        "Buy a Backstop policy on Arc from the agent's own wallet. Pays `payout` USDC if `outcome` happens. Costs payout × (ask + 0.03). Limits are enforced server-side.",
      parameters: {
        type: "object",
        properties: {
          instrumentSymbol: { type: "string", description: "Exact symbol from screen_markets" },
          outcome: { type: "string", enum: ["yes", "no"] },
          payout: { type: "integer", description: `Whole USDC, 1 to ${cfg.AGENT_MAX_PAYOUT}` },
          reason: { type: "string", description: "One sentence on why this hedges the user's risk" },
        },
        required: ["instrumentSymbol", "outcome", "payout", "reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "start_watch",
      description:
        "Start a standing order the agent runs every screener cycle: buy `payout` USDC of cover on `asset` `outcome` once per `horizon` window while the ask is at or below `maxPrice`.",
      parameters: {
        type: "object",
        properties: {
          asset: { type: "string" },
          outcome: { type: "string", enum: ["yes", "no"] },
          horizon: { type: "string", enum: ["5m", "15m", "1h"] },
          payout: { type: "integer" },
          maxPrice: { type: "number", description: "Highest ask (0.05–0.90) the agent will pay per contract" },
          note: { type: "string", description: "What the user wants protected, in a few words" },
        },
        required: ["asset", "outcome", "horizon", "payout", "maxPrice", "note"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "stop_watch",
      description: "Stop a standing watch by id.",
      parameters: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
    },
  },
  {
    type: "function",
    function: {
      name: "set_autopilot",
      description:
        "Turn the autopilot on or off and/or set its mandate: a plain-English standing instruction. On every screener finding (and every 5 min) you review the findings under this mandate and buy or hold on your own.",
      parameters: {
        type: "object",
        properties: {
          enabled: { type: "boolean" },
          mandate: { type: "string", description: "The hedging goal in plain English, e.g. 'Protect my ETH against short drops; hedge about a 1% move.'" },
          holdings: {
            type: "array",
            description: "The portfolio to protect, e.g. [{asset:'BTC', amount:0.01}, {asset:'ETH', amount:0.3}]. Crypto assets with Gemini spot prices: BTC, ETH, SOL, XRP.",
            items: { type: "object", properties: { asset: { type: "string" }, amount: { type: "number" } }, required: ["asset", "amount"] },
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "recent_activity",
      description: "Read the agent's recent activity feed: screener findings, on-chain changes and actions.",
      parameters: { type: "object", properties: {} },
    },
  },
] as const;

function system() {
  return [
    "You are Grok, running as the autonomous hedging agent inside Backstop, a testnet app on Arc.",
    "Backstop sells parametric cover: a policy pays N USDC if an outcome of a Gemini prediction market happens. Premium = N × (ask + 0.03). Every policy is hedged on Gemini by the backend.",
    `You control your own testnet wallet (${agentAddress}). You can screen markets, check your on-chain status, buy cover, and run standing watches. Limits: max ${cfg.AGENT_MAX_PAYOUT} USDC payout per policy, ${cfg.AGENT_DAILY_BUDGET_USDC} USDC of premiums per day; the server enforces them.`,
    "Hedging logic: long an asset and afraid of a drop → NO on an 'at or above' / 'up' market. Short or waiting to buy and afraid of a rise → YES. Match the asset and time horizon. Prefer strikes near the money (asks 0.25–0.75) unless the user wants tail/crash cover.",
    "Buy only when the user's latest message clearly asks you to buy or protect them now (e.g. 'protect me', 'buy cover', 'hedge this'). Then call screen_markets and buy_cover in the same turn; a purchase only exists if buy_cover returned bought=true.",
    "Questions ('which market would you use', 'what would it cost', 'should I') and anything saying don't buy / just explain / just tell me are advice only: screen and explain, never call buy_cover.",
    "If buy_cover fails, do not retry the same purchase in this turn. Explain the failure in plain words. Don't promise to retry later unless you started a watch that will; offer to start one instead.",
    "If the request is ambiguous (no asset, or it isn't about risk), ask one short question instead of buying.",
    "For recurring protection ('keep me covered', 'every window', 'whenever it's cheap'), prefer set_autopilot with a clear mandate: you then review every screener finding and decide yourself. Use start_watch only for a fixed mechanical rule.",
    "Never claim a purchase, watch or result that a tool didn't confirm. Quote real numbers from tool results: strike, time, premium, policy number.",
    `Current time: ${new Date().toISOString()}. Market symbols encode the close time in UTC as YYMMDDHHMM, e.g. GEMI-BTC2611182200-HI63000 closes 2026-11-18 22:00 UTC; prefer the question text and closesInMin from tools.`,
    "You also run an autopilot (agent_status shows its mandate, holdings and whether it is on). Mention it when asked what you're doing or watching.",
    "This is testnet money; say so if the user asks about real funds.",
    [
      "FORMAT. Every reply uses this layout, in this order, and nothing else:",
      "1. One headline line in bold that answers directly, e.g. **Bought ETH downside cover, policy No. 15** or **Best BTC cover for the next hour** or **No purchase: cover is too expensive right now**.",
      "2. A facts block: one fact per line as 'Label: value', no bullets, no bold. Use only labels that apply, from: Market, Pays if, Closes, Cover, Price, Premium, Policy, Wallet, Spent today, Autopilot, Holdings, Watches, Reason. Example:",
      "   Market: ETH price on Nov 18, 22:00 UTC",
      "   Pays if: ETH is below $1,760",
      "   Closes: 22:00 UTC (in 48 min)",
      "   Cover: 3.00 USDC",
      "   Premium: 1.05 USDC (0.32 + 0.03 spread per $1)",
      "   Policy: No. 15",
      "3. Optionally 'Why:' on its own line followed by at most three short bullets starting with '- '.",
      "4. Optionally one final plain sentence with the next step or an offer.",
      "Separate the parts with one blank line. For a list of several policies or markets, use one bullet per item in the form '- No. 14: 5.00 USDC if ETH is below $1,760 at 22:00 UTC, premium 1.65 USDC'.",
      "A clarifying question is just one plain sentence, with no headline or facts.",
      "Never show internal symbols (GEMI-...), tool or field names (askNo, closesInMin), or trader shorthand (OTM, ITM, ATM, bps). Describe markets in words from the question text. Write money as '1.05 USDC', prices as '0.32 per $1', times in UTC with the time left.",
      "Under 110 words. No emojis, no em dashes, no headings with #, no tables. Tone: calm and professional, like a broker's confirmation.",
    ].join("\n"),
  ].join("\n");
}

type Msg = { role: "system" | "user" | "assistant" | "tool"; content: string | null; tool_calls?: ToolCall[]; tool_call_id?: string };
type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

async function grok(messages: Msg[]) {
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.GROK_API_KEY}` },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({ model: cfg.GROK_MODEL, temperature: 0.3, messages, tools: TOOLS, tool_choice: "auto" }),
  });
  const body = (await res.json().catch(() => ({}))) as { choices?: { message: Msg }[] };
  if (!res.ok || !body.choices?.[0]) throw new QuoteError(`Grok request failed (HTTP ${res.status}).`, "assistant_upstream", 502);
  return body.choices[0].message;
}

async function grokFinal(messages: Msg[]) {
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.GROK_API_KEY}` },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({ model: cfg.GROK_MODEL, temperature: 0.3, messages, tools: TOOLS, tool_choice: "none" }),
  });
  const body = (await res.json().catch(() => ({}))) as { choices?: { message: Msg }[] };
  return body.choices?.[0]?.message.content ?? "I ran out of steps before finishing. Check the activity feed for what happened.";
}

const compact = (m: MarketView) => ({
  symbol: m.instrumentSymbol,
  question: m.question,
  closesInMin: Math.round(m.secondsToExpiry / 60),
  askYes: m.askYes,
  askNo: m.askNo,
});

async function runTool(name: string, rawArgs: string, steps: Step[], lastUserText: string): Promise<unknown> {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(rawArgs || "{}");
  } catch {
    /* empty args */
  }
  try {
    switch (name) {
      case "screen_markets": {
        const all = await marketsForAgent();
        const asset = typeof args.asset === "string" ? args.asset.toUpperCase() : undefined;
        const horizon = typeof args.horizon === "string" ? args.horizon : undefined;
        const hits = all.filter((m) => (!asset || assetOf(m.instrumentSymbol) === asset) && (!horizon || horizonOf(m) === horizon) && m.secondsToExpiry > 120);
        steps.push({
          tool: name,
          ok: true,
          label: `Screened ${all.length} ${cfg.MOCK_MARKETS ? "sample" : "live Gemini"} markets`,
          detail: `${hits.length} match${asset ? ` ${asset}` : ""}${horizon ? `\n${horizon} windows` : ""}`,
        });
        return { markets: hits.slice(0, 15).map(compact) };
      }
      case "agent_status": {
        const [balance] = await Promise.all([agentBalance()]);
        const policies = db
          .prepare(
            "SELECT policy_id, instrument_symbol, outcome, payout, premium, status, hedge_status, hedge_fill_price FROM policies WHERE buyer = ? ORDER BY policy_id DESC LIMIT 8",
          )
          .all((agentAddress ?? "").toLowerCase()) as Record<string, unknown>[];
        steps.push({ tool: name, ok: true, label: "Read agent wallet and policies on Arc", detail: `${formatUsdc(balance)} USDC\n${policies.length} policies` });
        return {
          wallet: agentAddress,
          balanceUsdc: formatUsdc(balance),
          spentTodayUsdc: formatUsdc(spentToday()),
          dailyBudgetUsdc: formatUsdc(dailyBudget()),
          policies: policies.map((p) => ({
            ...p,
            outcome: p.outcome === 1 ? "yes" : "no",
            payout: formatUsdc(BigInt(p.payout as string)),
            premium: formatUsdc(BigInt(p.premium as string)),
          })),
          watches: listWatches(),
          autopilot: (() => {
            const ap = autopilotState();
            return { enabled: ap.enabled, mandate: ap.mandate, holdings: ap.holdings, lastDecisionAt: ap.lastDecisionAt };
          })(),
        };
      }
      case "buy_cover": {
        const p = z
          .object({ instrumentSymbol: z.string(), outcome: z.enum(["yes", "no"]), payout: z.coerce.number(), reason: z.string() })
          .parse(args);
        const market = (await marketsForAgent()).find((m) => m.instrumentSymbol === p.instrumentSymbol);
        if (!market) {
          steps.push({ tool: name, ok: false, label: "Purchase refused", detail: "That market isn't open any more." });
          return { error: "market not found or closed; screen again" };
        }
        const r = await buyCover(
          { market, outcome: p.outcome, payout: p.payout },
          {
            instruction: lastUserText,
            summary: `Cover ${Math.min(p.payout, cfg.AGENT_MAX_PAYOUT)} USDC if ${p.outcome.toUpperCase()}: ${market.question}`,
            reasoning: p.reason,
            source: "chat",
          },
        );
        if (r.status === "bought") {
          steps.push({
            tool: name,
            ok: true,
            label: `Bought policy No. ${r.policyId} on Arc`,
            detail: `${r.premiumUsdc} USDC for ${r.payout}.00 USDC of cover`,
            url: r.url,
            policyId: r.policyId,
          });
          return { bought: true, policyId: r.policyId, premiumUsdc: r.premiumUsdc, payout: r.payout, tx: r.tx, explorer: r.url };
        }
        steps.push({ tool: name, ok: false, label: r.status === "blocked" ? "Purchase blocked by limits" : "Purchase failed", detail: r.error });
        return { bought: false, reason: r.error };
      }
      case "start_watch": {
        const w = z
          .object({
            asset: z.string(),
            outcome: z.enum(["yes", "no"]),
            horizon: z.enum(["5m", "15m", "1h"]),
            payout: z.coerce.number(),
            maxPrice: z.coerce.number(),
            note: z.string(),
          })
          .parse(args);
        const id = createWatch(w);
        steps.push({
          tool: name,
          ok: true,
          label: `Started watch #${id}`,
          detail: `${w.asset.toUpperCase()} ${w.outcome.toUpperCase()}\nevery ${w.horizon} window\nmax ${w.maxPrice.toFixed(2)}`,
        });
        return { watchId: id, runsEverySec: Math.round(cfg.SCREENER_INTERVAL_MS / 1000) };
      }
      case "stop_watch": {
        const id = Number(args.id);
        const ok = stopWatch(id);
        steps.push({ tool: name, ok, label: ok ? `Stopped watch #${id}` : `No active watch #${id}` });
        return { stopped: ok };
      }
      case "set_autopilot": {
        const p = z
          .object({
            enabled: z.boolean().optional(),
            mandate: z.string().min(10).max(400).optional(),
            holdings: z.array(z.object({ asset: z.string(), amount: z.coerce.number().positive() })).max(4).optional(),
          })
          .parse(args);
        const st = setAutopilot(p);
        steps.push({
          tool: name,
          ok: true,
          label: `Autopilot ${st.enabled ? "on" : "off"}${p.mandate ? "\nnew mandate" : ""}${p.holdings ? "\nnew holdings" : ""}`,
          detail: p.holdings ? p.holdings.map((h) => `${h.amount} ${h.asset.toUpperCase()}`).join(", ") : p.mandate ? st.mandate : undefined,
        });
        return st;
      }
      case "recent_activity": {
        const ev = recentEvents(12);
        steps.push({ tool: name, ok: true, label: "Read the activity feed", detail: `${ev.length} recent events` });
        return { events: ev.map((e) => ({ at: new Date(e.at * 1000).toISOString(), kind: e.kind, title: e.title, detail: e.detail })) };
      }
      default:
        return { error: `unknown tool ${name}` };
    }
  } catch (e) {
    const msg = e instanceof QuoteError ? e.message : (e as Error).message.split("\n")[0]!;
    steps.push({ tool: name, ok: false, label: `${name.replace("_", " ")} failed`, detail: msg });
    return { error: msg };
  }
}

export const chatBody = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(2000) }))
    .min(1)
    .max(30),
});

/** The user said not to buy (or only asked for an explanation): purchases are off for this turn. */
const NO_BUY = /\b(don'?t|do not|dont|no|without)\s+(buy|buying|purchas\w*)\b|\bjust (explain|tell|show|asking)\b|\bnot yet\b|\bhypothetical(ly)?\b/i;

export async function chat(history: z.infer<typeof chatBody>["messages"]) {
  if (!agentEnabled()) throw new QuoteError("The Grok Bot is switched off on this server.", "agent_off", 503);
  const lastUserText = [...history].reverse().find((m) => m.role === "user")?.content.slice(0, 300) ?? "";
  const messages: Msg[] = [{ role: "system", content: system() }, ...history.slice(-12)];
  const steps: Step[] = [];
  let nudged = false;
  for (let round = 0; round < 5; round++) {
    const msg = await grok(messages);
    messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: msg.tool_calls });
    if (!msg.tool_calls?.length) {
      // safety net: a reply that describes a purchase must be backed by a buy_cover call
      const claimsBuy = /\b(buying|bought|purchas(ed|ing)|i('ve| have) (bought|covered))\b/i.test(msg.content ?? "");
      if (claimsBuy && !steps.some((s) => s.tool === "buy_cover") && !nudged) {
        nudged = true;
        messages.push({
          role: "system",
          content: "Your reply describes a purchase, but you did not call buy_cover. Either call buy_cover now, or rewrite the reply without claiming a purchase.",
        });
        continue;
      }
      return { reply: msg.content ?? "", steps, model: cfg.GROK_MODEL };
    }
    for (const call of msg.tool_calls) {
      const result =
        call.function.name === "buy_cover" && NO_BUY.test(lastUserText)
          ? (steps.push({ tool: "buy_cover", ok: false, label: "Purchase skipped", detail: "You asked not to buy" }),
            { error: "The user asked not to buy. Explain your recommendation instead." })
          : await runTool(call.function.name, call.function.arguments, steps, lastUserText);
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  // out of tool rounds: ask for a plain summary of what happened, with tools disabled
  messages.push({ role: "system", content: "Stop calling tools. Summarise for the user what you did and what happened, in a few lines." });
  const final = await grokFinal(messages);
  return { reply: final, steps, model: cfg.GROK_MODEL };
}

