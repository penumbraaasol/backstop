"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type AgentActivity, type AgentEvent } from "@/lib/api";
import { useNow } from "@/lib/hooks";
import { cx, ExtLink, Spinner } from "./ui";

const ago = (unix: number | null, now: number) => {
  if (!unix) return "not yet";
  const s = Math.max(0, Math.floor(now / 1000 - unix));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
};

/** The agent's background jobs and its live activity feed. */
export function AgentJobs() {
  const now = useNow(1000);
  const { data } = useQuery({ queryKey: ["agentActivity"], queryFn: api.activity, refetchInterval: 3_000 });
  if (!data)
    return (
      <div className="space-y-3">
        <div className="placeholder h-40" />
        <div className="placeholder h-80" />
      </div>
    );
  return (
    <div className="flex h-[640px] flex-col gap-3">
      <Jobs jobs={data.jobs} now={now} />
      <Feed events={data.events} now={now} />
    </div>
  );
}

function Jobs({ jobs, now }: { jobs: AgentActivity["jobs"]; now: number }) {
  const fresh = (t: number | null) => !!t && now / 1000 - t < jobs.intervalSec * 2.5;
  const rows = [
    {
      name: "Market screener",
      what: `Reads every live Gemini market, flags price jumps of 8¢+, cheap tail cover and new windows`,
      metric: `${jobs.screener.marketsScanned} markets · ${jobs.screener.findings} findings`,
      stat: jobs.screener,
    },
    {
      name: "On-chain watcher",
      what: "Follows the agent's policies on Arc and the treasury's free liquidity",
      metric: `${jobs.onchain.policiesTracked} open · treasury ${jobs.onchain.freeLiquidityUsdc ?? "–"} USDC`,
      stat: jobs.onchain,
    },
  ];
  return (
    <div className="rounded-[22px] border border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <p className="text-sm font-semibold tracking-tight">Running jobs</p>
        <p className="font-mono text-[11px] text-fg-3">every {jobs.intervalSec}s</p>
      </div>
      <ul className="divide-y divide-line">
        {rows.map((r) => (
          <li key={r.name} className="px-5 py-3">
            <div className="flex items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-sm font-medium">
                <Pulse ok={fresh(r.stat.lastRunAt) && !r.stat.lastError} />
                {r.name}
              </p>
              <span className="num font-mono text-[11px] text-fg-3">{ago(r.stat.lastRunAt, now)}</span>
            </div>
            <p className="mt-0.5 text-xs text-fg-2">{r.stat.lastError ? <span className="text-down">{r.stat.lastError}</span> : r.metric}</p>
          </li>
        ))}
        <Watches jobs={jobs} now={now} />
      </ul>
    </div>
  );
}

function Watches({ jobs, now }: { jobs: AgentActivity["jobs"]; now: number }) {
  const qc = useQueryClient();
  const stop = useMutation({
    mutationFn: (id: number) => api.stopWatch(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agentActivity"] }),
  });
  const list = jobs.watches.list;
  return (
    <li className="px-5 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Pulse ok={list.length > 0} idle={list.length === 0} />
          Watches
        </p>
        <span className="text-[11px] text-fg-3">{list.length ? `${list.length} active` : "none"}</span>
      </div>
      {list.length === 0 ? (
        <p className="mt-0.5 text-xs text-fg-2">Standing orders you start in the chat. They buy when the screener finds a match.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {list.map((w) => (
            <li key={w.id} className="rounded-xl bg-surface-2 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium">
                  #{w.id} · {w.asset} <span className={w.outcome === "yes" ? "text-fg" : "text-fg-2"}>{w.outcome.toUpperCase()}</span> ·{" "}
                  {w.payout} USDC · every {w.horizon} · max {w.maxPrice.toFixed(2)}
                </p>
                <button
                  onClick={() => stop.mutate(w.id)}
                  disabled={stop.isPending}
                  className="text-[11px] text-fg-2 underline-offset-4 hover:text-down hover:underline"
                >
                  Stop
                </button>
              </div>
              <p className="mt-0.5 text-[11px] text-fg-2">
                {w.lastResult ?? "Waiting for the next scan"} <span className="text-fg-3">· {ago(w.lastRun, now)}</span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function Pulse({ ok, idle }: { ok: boolean; idle?: boolean }) {
  return (
    <span className="relative flex size-2">
      {ok && <span className="absolute inline-flex size-full animate-ping rounded-full bg-up opacity-50" />}
      <span className={cx("relative inline-flex size-2 rounded-full", idle ? "bg-line-strong" : ok ? "bg-up" : "bg-warn")} />
    </span>
  );
}

const KIND: Record<AgentEvent["kind"], { label: string; cls: string }> = {
  action: { label: "Bought", cls: "text-up" },
  onchain: { label: "On-chain", cls: "text-fg" },
  finding: { label: "Finding", cls: "text-warn" },
  scan: { label: "Screener", cls: "text-fg-2" },
  watch: { label: "Watch", cls: "text-fg-2" },
  error: { label: "Failed", cls: "text-down" },
};

function Feed({ events, now }: { events: AgentEvent[]; now: number }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-[22px] border border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <p className="text-sm font-semibold tracking-tight">Activity</p>
        <p className="flex items-center gap-1.5 text-[11px] text-fg-3">
          <Spinner className="size-3" /> live
        </p>
      </div>
      {events.length === 0 ? (
        <p className="px-5 py-6 text-sm text-fg-2">Nothing yet. Findings, on-chain changes and purchases show up here.</p>
      ) : (
        <ol className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
          {events.map((e) => (
            <li key={e.id} className="settle px-5 py-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-[13px] leading-snug">
                  <span className={cx("mr-2 text-[10px] font-semibold uppercase tracking-[0.08em]", KIND[e.kind].cls)}>{KIND[e.kind].label}</span>
                  {e.title}
                </p>
                <span className="num shrink-0 font-mono text-[11px] text-fg-3">{ago(e.at, now)}</span>
              </div>
              {(e.detail || e.url) && (
                <p className="mt-0.5 text-xs text-fg-2">
                  {e.detail}
                  {e.url && (
                    <ExtLink href={e.url} className="ml-1.5 font-mono">
                      tx ↗
                    </ExtLink>
                  )}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
