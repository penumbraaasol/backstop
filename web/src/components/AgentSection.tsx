"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { addressUrl } from "@/lib/chain";
import { shortAddr } from "@/lib/format";
import { useBackendConfig, usePolicies } from "@/lib/hooks";
import { AgentChat } from "./AgentChat";
import { AgentJobs } from "./AgentJobs";
import { TrackedPolicy } from "./MyCover";
import { Eyebrow, ExtLink } from "./ui";

/** Grok as an autonomous hedging agent: chat, background jobs, live activity, and its policies on Arc. */
export function AgentSection() {
  const { data: conf } = useBackendConfig();
  const { data: a } = useQuery({ queryKey: ["agent"], queryFn: api.agent, enabled: !!conf?.agent, refetchInterval: 5_000 });
  const { data: policies } = usePolicies(a?.address ?? undefined);
  if (conf && !conf.agent)
    return (
      <section className="mx-auto max-w-[1240px] px-5 py-20 sm:px-8">
        <Eyebrow>Grok agent</Eyebrow>
        <h1 className="mt-3 text-xl font-semibold tracking-[-0.03em]">The agent is switched off on this server.</h1>
        <p className="mt-2 max-w-md text-sm text-fg-2">Set GROK_API_KEY, PRIVATE_KEY_AGENT and AGENT_ENABLED=true on the backend to turn it on.</p>
      </section>
    );
  if (!a)
    return (
      <section className="mx-auto max-w-[1240px] px-5 py-20 sm:px-8">
        <div className="placeholder h-24 max-w-xl" />
        <div className="mt-10 grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
          <div className="placeholder h-[640px] rounded-[22px]" />
          <div className="placeholder h-[640px] rounded-[22px]" />
        </div>
      </section>
    );

  const spent = Number(a.spentTodayUsdc);
  const budget = Number(a.dailyBudgetUsdc);

  return (
    <section className="mx-auto max-w-[1240px] px-5 pb-20 pt-12 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-8">
        <div className="max-w-xl">
          <Eyebrow>Grok agent</Eyebrow>
          <h1 className="mt-3 text-xl font-semibold tracking-[-0.03em]">An AI hedger with its own wallet</h1>
          <p className="mt-2 text-sm text-fg-2">
            Grok screens the live markets and the chain on a loop, and buys cover on Arc when you ask it to or when one of
            its watches finds a match. No human signs its purchases. The server enforces its limits.
          </p>
          {a.sampleMarkets && (
            <p className="mt-3 text-xs text-warn">Development mode: the screener is reading sample markets because Gemini is unavailable.</p>
          )}
        </div>
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[18px] border border-line bg-line text-sm sm:grid-cols-4">
          <Stat k="Wallet">
            <ExtLink href={addressUrl(a.address!)} className="font-mono text-[13px]">
              {shortAddr(a.address!)}
            </ExtLink>
          </Stat>
          <Stat k="Balance">
            <span className="num font-semibold">{a.balanceUsdc} USDC</span>
          </Stat>
          <Stat k="Spent today">
            <span className="num">
              {a.spentTodayUsdc}
              <span className="text-fg-3"> / {a.dailyBudgetUsdc}</span>
            </span>
            <span className="mt-1.5 block h-[3px] overflow-hidden rounded-full bg-surface-2">
              <span className={spent / budget > 0.8 ? "block h-full bg-warn" : "block h-full bg-fg-2"} style={{ width: `${Math.min(100, (spent / budget) * 100)}%` }} />
            </span>
          </Stat>
          <Stat k="Per policy">
            <span className="num">≤ {a.maxPayoutUsdc} USDC</span>
          </Stat>
        </dl>
      </div>

      <div className="mt-10 grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <AgentChat />
        <AgentJobs />
      </div>

      {policies && policies.length > 0 && (
        <div className="mt-14">
          <h3 className="text-sm font-semibold tracking-tight">Policies the agent holds</h3>
          <div className="mt-4 space-y-6">
            {policies.slice(0, 3).map((p) => (
              <TrackedPolicy key={p.policyId} p={p} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function Stat({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="min-w-[8.5rem] bg-bg px-4 py-3">
      <dt className="text-xs text-fg-2">{k}</dt>
      <dd className="mt-1">{children}</dd>
    </div>
  );
}
