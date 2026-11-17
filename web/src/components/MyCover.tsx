"use client";

import { Check, ExternalLink, FileText, Loader2, RotateCcw, X } from "lucide-react";
import { useConnection } from "wagmi";
import type { PolicyTimeline } from "@/lib/api";
import { localTime, usd } from "@/lib/format";
import { usePolicies } from "@/lib/hooks";
import { ConnectButton, useMounted } from "./ConnectButton";
import { Badge, cx, SectionHeading } from "./ui";

export function MyCover() {
  const mounted = useMounted();
  const { address, isConnected } = useConnection();
  const { data: policies, isLoading } = usePolicies(address);

  return (
    <section id="policies" className="mx-auto max-w-7xl px-5 py-20 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <SectionHeading
          eyebrow="My cover"
          title="Every policy, tracked to settlement."
          sub="Each step links to its onchain transaction on Arc."
        />
        {policies && policies.length > 0 && <Summary policies={policies} />}
      </div>

      <div className="mt-10">
        {!mounted ? (
          <div className="h-40 rounded-2xl skeleton" />
        ) : !isConnected ? (
          <div className="card flex flex-col items-center justify-center gap-4 p-12 text-center">
            <FileText className="size-6 text-muted" />
            <p className="text-muted">Connect a wallet to see your policies.</p>
            <ConnectButton />
          </div>
        ) : isLoading ? (
          <div className="space-y-3">
            {[0, 1].map((i) => (
              <div key={i} className="h-36 rounded-2xl skeleton" />
            ))}
          </div>
        ) : !policies?.length ? (
          <div className="card flex flex-col items-center justify-center gap-2 p-12 text-center">
            <FileText className="size-6 text-muted" />
            <p className="font-medium">No policies yet</p>
            <p className="text-sm text-muted">Your cover shows up here a few seconds after you buy it.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {policies.map((p) => (
              <PolicyCard key={p.policyId} p={p} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Summary({ policies }: { policies: PolicyTimeline[] }) {
  const active = policies.filter((p) => p.status === "active").length;
  const paid = policies.filter((p) => p.status === "paid_out").reduce((s, p) => s + Number(p.payoutUsdc), 0);
  return (
    <div className="flex gap-6 text-sm">
      <div>
        <p className="text-xs text-faint">Active</p>
        <p className="text-lg font-semibold tabular-nums">{active}</p>
      </div>
      <div>
        <p className="text-xs text-faint">Paid out to you</p>
        <p className="text-lg font-semibold tabular-nums text-mint">{usd(paid)}</p>
      </div>
    </div>
  );
}

const STATUS: Record<PolicyTimeline["status"], { label: string; tone: "mint" | "yes" | "neutral" | "warn" }> = {
  active: { label: "Active", tone: "mint" },
  paid_out: { label: "Paid out", tone: "yes" },
  expired: { label: "Expired", tone: "neutral" },
  refunded: { label: "Refunded", tone: "warn" },
};

type StepState = "done" | "current" | "todo" | "fail";

function PolicyCard({ p }: { p: PolicyTimeline }) {
  const s = p.steps;
  const st = STATUS[p.status];
  const hedgeFailed = s.hedged.status === "failed";
  const refunded = p.status === "refunded";

  const steps: { title: string; detail: string; state: StepState; url?: string | null }[] = [
    { title: "Purchased", detail: `Premium ${usd(Number(p.premiumUsdc))}`, state: "done", url: s.purchased.url },
    {
      title: "Hedged on Gemini",
      detail:
        s.hedged.status === "pending"
          ? "Placing order…"
          : hedgeFailed
            ? "Order didn't fill"
            : `${s.hedged.filledQty ?? ""} ${p.outcome.toUpperCase()} @ ${s.hedged.fillPrice ?? "?"}${s.hedged.mode ? ` · ${s.hedged.mode}` : ""}`,
      state: s.hedged.status === "pending" ? "current" : hedgeFailed ? "fail" : "done",
    },
    refunded
      ? { title: "Cancelled", detail: "No hedge, no risk taken", state: "done" }
      : {
          title: "Resolved",
          detail: s.resolved.done ? `Gemini result: ${s.resolved.result?.toUpperCase()}` : p.marketExpiry ? `At ${localTime(p.marketExpiry)}` : "Waiting for result",
          state: s.resolved.done ? "done" : s.hedged.status === "pending" ? "todo" : "current",
          url: s.resolved.url,
        },
    refunded
      ? { title: "Refunded", detail: `${usd(Number(p.premiumUsdc))} returned`, state: "done", url: s.settled.url }
      : {
          title: p.status === "paid_out" ? "Paid out" : p.status === "expired" ? "Expired" : "Settlement",
          detail:
            p.status === "paid_out"
              ? `${usd(Number(p.payoutUsdc))} sent to you`
              : p.status === "expired"
                ? "Outcome didn't happen"
                : `Pays ${usd(Number(p.payoutUsdc))} if ${p.outcome.toUpperCase()}`,
          state: s.settled.done ? "done" : s.resolved.done ? "current" : "todo",
          url: s.settled.url,
        },
  ];

  return (
    <li className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="font-mono text-sm text-faint">#{p.policyId}</span>
          <div className="min-w-0">
            <p className="truncate font-medium">{p.marketTitle ?? p.instrumentSymbol}</p>
            <p className="truncate font-mono text-[11px] text-faint">{p.instrumentSymbol}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={p.outcome === "yes" ? "yes" : "no"}>Pays if {p.outcome.toUpperCase()}</Badge>
          <Badge tone="neutral">
            {usd(Number(p.premiumUsdc))} → {usd(Number(p.payoutUsdc))}
          </Badge>
          <Badge tone={st.tone} dot>
            {st.label}
          </Badge>
        </div>
      </div>
      <ol className="grid gap-0 px-5 py-5 sm:grid-cols-4">
        {steps.map((step, i) => (
          <li key={i} className="relative flex gap-3 pb-5 sm:flex-col sm:pb-0 sm:pr-4">
            {i < steps.length - 1 && (
              <span
                className={cx(
                  "absolute left-[11px] top-7 h-[calc(100%-1.5rem)] w-px sm:left-7 sm:top-[11px] sm:h-px sm:w-[calc(100%-2rem)]",
                  step.state === "done" ? "bg-mint/50" : "bg-line",
                )}
              />
            )}
            <StepIcon state={step.state} refund={refunded && i >= 2} />
            <div className="min-w-0">
              <p className={cx("text-sm font-medium", step.state === "todo" && "text-faint")}>{step.title}</p>
              <p className="mt-0.5 text-xs text-muted">{step.detail}</p>
              {step.url && (
                <a
                  href={step.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-xs text-mint/90 hover:text-mint"
                >
                  View tx <ExternalLink className="size-3" />
                </a>
              )}
            </div>
          </li>
        ))}
      </ol>
      {hedgeFailed && s.hedged.error && (
        <p className="border-t border-line px-5 py-3 text-xs text-faint">Hedge note: {s.hedged.error}</p>
      )}
    </li>
  );
}

function StepIcon({ state, refund }: { state: StepState; refund?: boolean }) {
  return (
    <span
      className={cx(
        "relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full",
        state === "done" && (refund ? "bg-warn text-ink" : "bg-mint text-ink"),
        state === "current" && "bg-mint/15 text-mint ring-1 ring-mint/40",
        state === "todo" && "bg-surface text-faint ring-1 ring-line",
        state === "fail" && "bg-no/15 text-no ring-1 ring-no/40",
      )}
    >
      {state === "done" ? (
        refund ? <RotateCcw className="size-3.5" strokeWidth={2.5} /> : <Check className="size-3.5" strokeWidth={3} />
      ) : state === "current" ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : state === "fail" ? (
        <X className="size-3.5" strokeWidth={3} />
      ) : (
        <span className="size-1.5 rounded-full bg-current" />
      )}
    </span>
  );
}

