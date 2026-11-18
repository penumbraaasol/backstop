"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, type AgentActivity, type AgentEvent, type Autopilot } from "@/lib/api";
import { GrokMark } from "./logos";
import { useNow } from "@/lib/hooks";
import { cx, ExtLink, Spinner } from "./ui";

/** separators from older log entries become line breaks */
const lines = (t: string) => t.replace(/\s+·\s+/g, "\n");

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
      <div className="flex flex-col gap-2.5 lg:h-[640px]">
        <div className="placeholder h-48" />
        <div className="placeholder h-32" />
        <div className="placeholder flex-1" />
      </div>
    );
  return (
    <div className="flex flex-col gap-2.5 lg:h-[640px]">
      <AutopilotCard ap={data.jobs.autopilot} now={now} />
      <Jobs jobs={data.jobs} now={now} />
      <Feed events={data.events.filter((e) => e.kind !== "error" && !/refunded|hedge didn't fill|rejected/i.test(e.title))} now={now} />
    </div>
  );
}

function Jobs({ jobs, now }: { jobs: AgentActivity["jobs"]; now: number }) {
  const fresh = (t: number | null) => !!t && now / 1000 - t < jobs.intervalSec * 2.5;
  const rows = [
    {
      name: "Market screener",
      metric: `${jobs.screener.marketsScanned} markets, ${jobs.screener.findings} findings`,
      stat: jobs.screener,
    },
    {
      name: "On-chain watcher",
      metric: `${jobs.onchain.policiesTracked} open, treasury ${jobs.onchain.freeLiquidityUsdc ?? "–"}`,
      stat: jobs.onchain,
    },
  ];
  return (
    <div className="shrink-0 rounded-[18px] border border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-4 py-2">
        <p className="text-sm font-semibold tracking-tight">Running jobs</p>
        <p className="font-mono text-[11px] text-fg-3">every {jobs.intervalSec}s</p>
      </div>
      <ul className="divide-y divide-line text-xs">
        {rows.map((r) => (
          <li key={r.name} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-2">
            <span className="flex items-center gap-2 text-[13px] font-medium">
              <Pulse ok={fresh(r.stat.lastRunAt) && !r.stat.lastError} />
              {r.name}
            </span>
            <span className={cx("num truncate text-right", r.stat.lastError ? "text-down" : "text-fg-2")}>
              {r.stat.lastError ?? r.metric}
            </span>
            <span className="num w-14 text-right font-mono text-[11px] text-fg-3">{ago(r.stat.lastRunAt, now)}</span>
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
    <li className="px-4 py-2">
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
        <span className="flex items-center gap-2 text-[13px] font-medium">
          <Pulse ok={list.length > 0} idle={list.length === 0} />
          Watches
        </span>
        <span className="truncate text-right text-fg-2">{list.length ? `${list.length} active` : "none, start one in the chat"}</span>
        <span className="w-14" />
      </div>
      {list.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {list.map((w) => (
            <li key={w.id} className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-2.5 py-1.5" title={w.lastResult ?? undefined}>
              <span className="num truncate">
                #{w.id} {w.asset} <span className={w.outcome === "yes" ? "text-up" : "text-down"}>{w.outcome.toUpperCase()}</span>, {w.payout} USDC, every{" "}
                {w.horizon}, max {w.maxPrice.toFixed(2)} <span className="text-fg-3">{ago(w.lastRun, now)}</span>
              </span>
              <button
                onClick={() => stop.mutate(w.id)}
                disabled={stop.isPending}
                className="shrink-0 text-[11px] text-fg-2 underline-offset-4 hover:text-down hover:underline"
              >
                Stop
              </button>
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
      <span className={cx("relative inline-flex size-2 rounded-full", idle ? "bg-fg-3" : ok ? "bg-up" : "bg-warn")} />
    </span>
  );
}

function AutopilotCard({ ap, now }: { ap: Autopilot; now: number }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(ap.mandate);
  const save = useMutation({
    mutationFn: (body: { enabled?: boolean; mandate?: string }) => api.setAutopilot(body),
    onSuccess: () => {
      setEditing(false);
      qc.invalidateQueries({ queryKey: ["agentActivity"] });
    },
  });
  return (
    <div className="shrink-0 rounded-[18px] border border-line bg-surface px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <GrokMark className="size-4" />
          Grok autopilot
          <Pulse ok={ap.enabled} idle={!ap.enabled} />
        </p>
        <button
          role="switch"
          aria-checked={ap.enabled}
          onClick={() => save.mutate({ enabled: !ap.enabled })}
          disabled={save.isPending}
          className={cx("relative h-5 w-9 rounded-full transition-colors", ap.enabled ? "bg-up" : "bg-line-strong")}
        >
          <span className={cx("absolute top-0.5 size-4 rounded-full bg-fg transition-all", ap.enabled ? "left-[18px]" : "left-0.5")} />
          <span className="sr-only">Autopilot {ap.enabled ? "on" : "off"}</span>
        </button>
      </div>
      {editing ? (
        <div className="mt-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={400}
            rows={3}
            className="w-full resize-none rounded-xl border border-line-strong bg-surface-2 px-3 py-2 text-xs text-fg focus:border-fg-3 focus:outline-none"
          />
          <div className="mt-1 flex justify-end gap-3 text-xs">
            <button onClick={() => setEditing(false)} className="text-fg-2 hover:text-fg">Cancel</button>
            <button onClick={() => save.mutate({ mandate: draft })} disabled={draft.trim().length < 10 || save.isPending} className="font-medium text-fg hover:underline">
              Save mandate
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => {
            setDraft(ap.mandate);
            setEditing(true);
          }}
          title={`${ap.mandate} (click to edit)`}
          className="mt-1.5 line-clamp-2 text-left text-xs leading-snug text-fg-2 hover:text-fg"
        >
          &ldquo;{ap.mandate}&rdquo;
        </button>
      )}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {ap.holdings.map((h) => (
          <span key={h.asset} className="num rounded-lg bg-surface-2 px-2.5 py-1 text-xs">
            <span className="font-medium">
              {h.amount} {h.asset}
            </span>
            {h.valueUsd !== null && <span className="ml-1.5 text-fg-2">${Math.round(h.valueUsd).toLocaleString("en-US")}</span>}
          </span>
        ))}
      </div>
      <ul className="mt-2 grid grid-cols-2 gap-x-3 text-[11px] leading-[1.35rem] text-fg-3">
        <li>downside cover only</li>
        <li>one policy per asset</li>
        <li>
          strike {ap.rules.minDistance * 100}% to +{ap.rules.maxDistance * 100}% of spot
        </li>
        <li>
          {ap.rules.minCost.toFixed(2)}–{ap.rules.maxCost.toFixed(2)} per $1
        </li>
        <li className="col-span-2">size ≈ loss on a {ap.rules.hedgeMove * 100}% drop</li>
      </ul>
      <p className="mt-1 text-[11px] text-fg-3">
        {ap.enabled
          ? `Reviews each finding, at least every ${Math.round(ap.reviewEverySec / 60)} min. Last decision ${ago(ap.lastDecisionAt, now)}.`
          : "Off. Findings are logged, but Grok won't act on them."}
      </p>
    </div>
  );
}

const KIND: Record<AgentEvent["kind"], { label: string; cls: string }> = {
  decision: { label: "Grok", cls: "text-fg" },
  action: { label: "Bought", cls: "text-up" },
  onchain: { label: "On-chain", cls: "text-fg" },
  finding: { label: "Finding", cls: "text-warn" },
  scan: { label: "Screener", cls: "text-fg-2" },
  watch: { label: "Watch", cls: "text-fg-2" },
  error: { label: "Failed", cls: "text-down" },
};

function Feed({ events, now }: { events: AgentEvent[]; now: number }) {
  return (
    <div className="flex min-h-[150px] flex-1 flex-col overflow-hidden rounded-[18px] border border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-4 py-2">
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
            <li key={e.id} className={cx("settle px-4 py-2", e.kind === "decision" && "bg-surface-2/60")}>
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-[13px] leading-snug">
                  {e.kind === "decision" ? (
                    <GrokMark className="mr-1.5 inline size-3.5 -translate-y-px align-middle" />
                  ) : (
                    <span className={cx("mr-2 text-[10px] font-semibold uppercase tracking-[0.08em]", (KIND[e.kind] ?? KIND.scan).cls)}>
                      {(KIND[e.kind] ?? KIND.scan).label}
                    </span>
                  )}
                  <span className={cx("whitespace-pre-line", e.kind === "decision" && e.title.startsWith("Buy") && "font-medium text-up")}>{lines(e.title)}</span>
                </p>
                <span className="num shrink-0 font-mono text-[11px] text-fg-3">{ago(e.at, now)}</span>
              </div>
              {(e.detail || e.url) && (
                <p className={cx("mt-0.5 whitespace-pre-line text-xs", e.kind === "decision" ? "text-fg" : "text-fg-2")}>
                  {e.detail && lines(e.detail)}
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
