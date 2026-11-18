"use client";

import { useEffect, useState, type ReactNode } from "react";
import { MarketPicker } from "@/components/MarketPicker";
import { AgentChat } from "@/components/AgentChat";
import type { ChatMessage } from "@/lib/api";
import { Leader, ScheduleView, type ScheduleProps } from "@/components/ScheduleView";
import { PolicyEntry } from "@/components/PolicyEntry";
import { Button, Eyebrow } from "@/components/ui";
import type { Market, PolicyTimeline } from "@/lib/api";
import type { BuyStep } from "@/lib/hooks";

const T0 = 1794887520; // fixed clock so screenshots are stable

const market = (now: number): Market => ({
  instrumentSymbol: "GEMI-BTC15M2611170545-UP",
  eventTicker: "BTC15M2611170545",
  title: "BTC price today at 12:45am EST",
  label: "Up",
  question: "BTC is at or above $64,935.82 at 05:45 UTC",
  category: "crypto",
  series: "BTC15M",
  kind: "15m",
  startTime: null,
  expiry: new Date(now + 9 * 60_000 + 51_000).toISOString(),
  secondsToExpiry: 591,
  strike: "64935.82",
  askYes: 0.6,
  askNo: 0.42,
  imageUrl: null,
  termsLink: null,
});

const tx = (c: string) => `0x${c.repeat(64)}`;
const url = (h: string) => `https://explorer.testnet.arc.io/tx/${h}`;

function policy(over: Partial<PolicyTimeline> & { hedge?: Partial<PolicyTimeline["steps"]["hedged"]>; resolved?: PolicyTimeline["steps"]["resolved"]; settled?: PolicyTimeline["steps"]["settled"] }): PolicyTimeline {
  const base: PolicyTimeline = {
    policyId: 7,
    buyer: "0x6d40a8b185b74574052c58bb322618ee543a366b",
    instrumentSymbol: "GEMI-BTC15M2611170545-UP",
    eventTicker: "BTC15M2611170545",
    marketTitle: "BTC price today at 12:45am EST",
    marketExpiry: new Date((T0 + 600) * 1000).toISOString(),
    outcome: "no",
    payoutUsdc: "2.00",
    premiumUsdc: "0.90",
    quotedPrice: 0.42,
    resolveBy: T0 + 1500,
    status: "active",
    steps: {
      purchased: { done: true, tx: tx("a"), url: url(tx("a")) },
      hedged: { status: "pending", mode: null, orderId: null, fillPrice: null, filledQty: null, error: null, at: null },
      resolved: { done: false },
      settled: { done: false },
    },
  };
  return {
    ...base,
    ...over,
    steps: {
      ...base.steps,
      hedged: { ...base.steps.hedged, ...over.hedge },
      resolved: over.resolved ?? base.steps.resolved,
      settled: over.settled ?? base.steps.settled,
    },
  };
}

const filled = { status: "filled" as const, mode: "sandbox", orderId: "145853902320513522", fillPrice: "0.41", filledQty: "2", at: T0 + 4 };

const POLICIES: [string, PolicyTimeline][] = [
  ["Policy: just bought, hedging", policy({})],
  ["Policy: hedged, waiting for result", policy({ hedge: filled })],
  [
    "Policy: paid out",
    policy({
      status: "paid_out",
      hedge: filled,
      resolved: { done: true, result: "no", tx: tx("b"), url: url(tx("b")) },
      settled: { done: true, paid: true, tx: tx("c"), url: url(tx("c")) },
    }),
  ],
  [
    "Policy: expired",
    policy({
      status: "expired",
      hedge: filled,
      resolved: { done: true, result: "yes", tx: tx("b"), url: url(tx("b")) },
      settled: { done: true, paid: false, tx: tx("c"), url: url(tx("c")) },
    }),
  ],
  [
    "Policy: hedge failed, refunded",
    policy({
      status: "refunded",
      hedge: { status: "failed", mode: "sandbox", orderId: "145853902320513600", error: "not filled at limit 0.44", at: T0 + 6 },
      settled: { done: true, refunded: true, tx: tx("d"), url: url(tx("d")) },
    }),
  ],
];

const CHAT: ChatMessage[] = [
  { role: "user", content: "I hold 0.3 BTC. Protect me from a dip in the next 15 minutes, about 2 USDC." },
  {
    role: "assistant",
    content:
      "Done. You're long BTC, so I bought **NO on BTC ≥ $64,300 at 06:15 UTC**: it pays if BTC finishes below that.\n\n- Policy No. 14, 2.00 USDC of cover\n- Premium 1.08 USDC (2 × (0.51 + 0.03))\n- Hedge order goes to Gemini now; you can follow it on the right",
    steps: [
      { tool: "screen_markets", ok: true, label: "Screened 48 live Gemini markets", detail: "3 match BTC · 15m" },
      { tool: "buy_cover", ok: true, label: "Bought policy No. 14 on Arc", detail: "1.08 USDC for 2.00 USDC of cover", url: "https://explorer.testnet.arc.io/tx/0xaaaa" },
    ],
  },
  { role: "user", content: "Keep me covered on every 15 minute window while it's cheaper than 0.55." },
  {
    role: "assistant",
    content: "Watch #2 is running. Every 30 seconds I check the next BTC 15-minute window and buy 2 USDC of NO cover once per window, but only while the ask is at or below 0.55.",
    steps: [{ tool: "start_watch", ok: true, label: "Started watch #2", detail: "BTC NO · every 15m window · max 0.55" }],
  },
];

const TIMES = { purchased: T0, resolved: T0 + 615, settled: T0 + 617 };

/** Sample markets whose prices drift every second, so the live row details can be reviewed offline. */
function useDriftingMarkets(now: number) {
  const base: Market[] = ["BTC", "ETH", "SOL", "XRP"].map((a, i) => ({
    ...market(now),
    instrumentSymbol: `GEMI-${a}15M2611170545-UP`,
    title: `${a} price today at 12:45am EST`,
    strike: ["64935.82", "1798.85", "74.78", "0.98"][i]!,
    startTime: new Date(now - (6 + i) * 60_000).toISOString(),
    askYes: [0.6, 0.53, 0.48, 0.35][i]!,
    askNo: [0.42, 0.5, 0.55, 0.68][i]!,
  }));
  const [ms, setMs] = useState(base);
  useEffect(() => {
    let k = 0;
    const t = setInterval(() => {
      k++;
      setMs((cur) =>
        cur.map((m, i) => {
          const step = Math.round(Math.sin(k * (i + 1.3)) * 2) / 100;
          const yes = Math.min(0.95, Math.max(0.05, +(m.askYes + step).toFixed(2)));
          return { ...m, askYes: yes, askNo: +(1.02 - yes).toFixed(2) };
        }),
      );
    }, 1000);
    return () => clearInterval(t);
  }, []);
  return ms;
}

export function PreviewStates() {
  const [now] = useState(() => Date.now());
  const m = market(now);
  const drifting = useDriftingMarkets(now);
  const [sel, setSel] = useState(drifting[0]!.instrumentSymbol);
  const base: ScheduleProps = {
    market: m,
    outcome: "no",
    setOutcome: () => {},
    payout: 2,
    setPayout: () => {},
    maxPayout: 5,
    spread: 0.03,
    now,
    wallet: "ready",
    balance: 14.62,
    step: "idle",
    onBuy: () => {},
    onReset: () => {},
    connectSlot: (
      <Button className="w-full py-3">Connect wallet</Button>
    ),
  };
  const steps: [string, Partial<ScheduleProps>][] = [
    ["Empty: no market chosen", { market: undefined }],
    ["Loading markets", { market: undefined, marketsLoading: true }],
    ["Not connected", { wallet: "disconnected" }],
    ["Quote shown", {}],
    ["Pending: fixing the price", { step: "quote" as BuyStep }],
    ["Pending: confirm in wallet", { step: "buy" as BuyStep, quoteExpiry: now + 41_000 }],
    ["Pending: waiting for Arc", { step: "confirm" as BuyStep, quoteExpiry: now + 33_000 }],
    ["Issued", { step: "done" as BuyStep, result: { policyId: 7, txHash: tx("a") as `0x${string}`, premiumUsdc: "0.90", payoutUsdc: "2.00" } }],
    ["Error", { step: "error" as BuyStep, error: "You rejected the request in your wallet." }],
    ["Not enough USDC", { balance: 0.4 }],
  ];

  return (
    <main className="mx-auto max-w-[1240px] px-5 py-12 sm:px-8">
      <Eyebrow>Design review</Eyebrow>
      <h1 className="mt-2 font-display text-xl">Every state, from fixed data</h1>
      <div className="mt-6 max-w-md space-y-1.5 text-sm">
        <Leader label="Text on background" value="#f2f2f3 / #0a0a0b" />
        <Leader label="YES / NO" value="#22ab94 / #f23645" />
      </div>

      <div className="mt-12 max-w-3xl">
        <Frame name="Grok agent chat: a purchase and a watch">
          <AgentChat seed={CHAT} />
        </Frame>
      </div>

      <div className="mt-12 max-w-3xl">
        <Frame name="Market table: live prices (sample data drifting every second)">
          <MarketPicker
            markets={drifting}
            loading={false}
            error={false}
            horizon="15m"
            setHorizon={() => {}}
            asset="ALL"
            setAsset={() => {}}
            selected={sel}
            outcome="no"
            onPick={(x) => setSel(x.instrumentSymbol)}
          />
        </Frame>
      </div>

      <div className="mt-12 grid gap-x-14 gap-y-16 md:grid-cols-2">
        {steps.map(([name, over]) => (
          <Frame key={name} name={name}>
            <ScheduleView {...base} {...over} />
          </Frame>
        ))}
      </div>

      <div className="mt-20 space-y-14">
        {POLICIES.map(([name, p]) => (
          <Frame key={name} name={name}>
            <PolicyEntry p={p} times={TIMES} />
          </Frame>
        ))}
      </div>
    </main>
  );
}

function Frame({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div data-state={name}>
      <p className="mb-3 font-mono text-xs text-fg-2">{name}</p>
      {children}
    </div>
  );
}
