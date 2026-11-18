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
      <div className="space-y-3">
        <div className="placeholder h-40" />
        <div className="placeholder h-80" />
      </div>
    );
  return (
    <div className="flex flex-col gap-3">
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
      what: `Reads every live Gemini market, flags price jumps of 8¢+, cheap tail cover and new windows`,
      metric: `${jobs.screener.marketsScanned} markets\n${jobs.screener.findings} findings`,
      stat: jobs.screener,
    },
    {
      name: "On-chain watcher",
      what: "Follows the agent's policies on Arc and the treasury's free liquidity",
      metric: `${jobs.onchain.policiesTracked} open\ntreasury ${jobs.onchain.freeLiquidityUsdc ?? "–"} USDC`,
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
            <p className="mt-0.5 whitespace-pre-line text-xs text-fg-2">{r.stat.lastError ? <span className="text-down">{r.stat.lastError}</span> : r.metric}</p>
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
                  #{w.id} {w.asset} <span className={w.outcome === "yes" ? "text-up" : "text-down"}>{w.outcome.toUpperCase()}</span>
                  <br />
                  {w.payout} USDC, every {w.horizon}
                  <br />
                  max {w.maxPrice.toFixed(2)}
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
                {w.lastResult ?? "Waiting for the next scan"}
                <br />
                <span className="text-fg-3">{ago(w.lastRun, now)}</span>
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
    <div className="rounded-[22px] border border-line bg-surface px-5 py-4">
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
          <div className="mt-1.5 flex justify-end gap-3 text-xs">
            <button onClick={() => setEditing(false)} className="text-fg-2 hover:text-fg">Cancel</button>
            <button onClick={() => save.mutate({ mandate: draft })} disabled={draft.trim().length < 10 || save.isPending} className="font-medium text-fg hover:underline">
              Save mandate
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => { setDraft(ap.mandate); setEditing(true); }} className="mt-2 block text-left text-xs leading-relaxed text-fg-2 hover:text-fg">
          &ldquo;{ap.mandate}&rdquo; <span className="text-fg-3 underline underline-offset-2">edit</span>
        </button>
      )}
      <dl className="mt-3 grid grid-cols-2 gap-2">
        {ap.holdings.map((h) => (
          <div key={h.asset} className="rounded-xl bg-surface-2 px-3 py-2">
            <dt className="text-[11px] text-fg-2">Holding</dt>
            <dd className="num text-sm font-medium">
              {h.amount} {h.asset}
              {h.valueUsd !== null && <span className="block text-xs text-fg-2">${Math.round(h.valueUsd).toLocaleString("en-US")}</span>}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-[11px] leading-relaxed text-fg-3">
        Rules:
        <br />
        downside cover only
        <br />
        strike {ap.rules.minDistance * 100}% to +{ap.rules.maxDistance * 100}% of spot
        <br />
        {ap.rules.minCost.toFixed(2)}–{ap.rules.maxCost.toFixed(2)} per $1
        <br />
        size ≈ loss on a {ap.rules.hedgeMove * 100}% drop
        <br />
        one policy per asset
      </p>
      <p className="mt-1.5 whitespace-pre-line text-[11px] text-fg-3">
        {ap.enabled
          ? `Reviews every finding and at least every ${Math.round(ap.reviewEverySec / 60)} min\nlast decision ${ago(ap.lastDecisionAt, now)}`
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
    <div className="flex max-h-[420px] min-h-[240px] flex-col rounded-[22px] border border-line bg-surface">
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
            <li key={e.id} className={cx("settle px-5 py-2.5", e.kind === "decision" && "bg-surface-2/60")}>
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-[13px] leading-snug">
                  {e.kind === "decision" ? (
                    <GrokMark className="mr-1.5 inline size-3.5 -translate-y-px align-middle" />
                  ) : (
                    <span className={cx("mr-2 text-[10px] font-semibold uppercase tracking-[0.08em]", KIND[e.kind].cls)}>{KIND[e.kind].label}</span>
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
