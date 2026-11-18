import type { ReactNode } from "react";
import type { PolicyTimeline } from "@/lib/api";
import { stamp, timeOfDay, usdc } from "@/lib/format";
import { cx, ExtLink, Spinner, Status, type Tone } from "./ui";

export type StepTimes = { purchased?: number; resolved?: number; settled?: number };

const shortHash = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;

function statusOf(p: PolicyTimeline): { tone: Tone; label: string } {
  if (p.status === "paid_out") return { tone: "paid", label: "Paid out" };
  if (p.status === "expired") return { tone: "neutral", label: "Expired" };
  if (p.status === "refunded") return { tone: "pending", label: "Refunded" };
  if (p.steps.hedged.status === "pending") return { tone: "pending", label: "Hedging" };
  return { tone: "active", label: "Active" };
}

type Row = { time?: number; title: string; detail: ReactNode; link?: ReactNode; state: "done" | "now" | "later" | "failed"; tone?: "paid" | "refund" };

/** One policy as a tracking log: time, event, detail, proof link. */
export function PolicyEntry({ p, times }: { p: PolicyTimeline; times: StepTimes }) {
  const s = p.steps;
  const side = p.outcome.toUpperCase();
  const st = statusOf(p);
  const refunded = p.status === "refunded";
  const hedgeFailed = s.hedged.status === "failed";
  const expiry = p.marketExpiry ? timeOfDay(p.marketExpiry) : "market close";
  const tx = (url?: string | null, hash?: string) =>
    url && hash ? (
      <ExtLink href={url} className="font-mono">
        tx {shortHash(hash)} ↗
      </ExtLink>
    ) : null;

  const rows: Row[] = [
    {
      time: times.purchased,
      title: "Purchased",
      detail: `Paid ${usdc(p.premiumUsdc)} USDC. ${usdc(p.payoutUsdc)} USDC locked in the contract for this policy.`,
      link: tx(s.purchased.url, s.purchased.tx),
      state: "done",
    },
    {
      time: s.hedged.at ?? undefined,
      title: hedgeFailed ? "Hedge not filled" : "Hedged on Gemini",
      detail:
        s.hedged.status === "pending"
          ? `Placing an order for ${Number(p.payoutUsdc)} ${side} contracts.`
          : hedgeFailed
            ? `The order for ${Number(p.payoutUsdc)} ${side} contracts didn't fill at an acceptable price.`
            : `Bought ${s.hedged.filledQty} ${side} at ${s.hedged.fillPrice}${s.hedged.mode ? ` (${s.hedged.mode})` : ""}.`,
      link: s.hedged.orderId ? <span className="font-mono text-fg-2">order {s.hedged.orderId}</span> : null,
      state: s.hedged.status === "pending" ? "now" : hedgeFailed ? "failed" : "done",
    },
  ];

  if (refunded) {
    rows.push({
      time: times.settled,
      title: "Refunded",
      detail: `${usdc(p.premiumUsdc)} USDC premium returned. No cover was taken.`,
      link: tx(s.settled.url, s.settled.tx),
      state: "done",
      tone: "refund",
    });
  } else {
    rows.push({
      time: s.resolved.done ? times.resolved : undefined,
      title: "Resolved",
      detail: s.resolved.done
        ? `Gemini's result: ${s.resolved.result?.toUpperCase()}.`
        : `Waiting for Gemini's result after ${expiry}.`,
      link: tx(s.resolved.url, s.resolved.tx),
      state: s.resolved.done ? "done" : s.hedged.status === "pending" ? "later" : "now",
    });
    rows.push({
      time: s.settled.done ? times.settled : undefined,
      title: p.status === "paid_out" ? "Paid out" : p.status === "expired" ? "Expired" : "Payout",
      detail:
        p.status === "paid_out"
          ? `${usdc(p.payoutUsdc)} USDC sent to your wallet.`
          : p.status === "expired"
            ? `The covered outcome didn't happen. The ${usdc(p.payoutUsdc)} USDC lock was released.`
            : `${usdc(p.payoutUsdc)} USDC if the result is ${side}.`,
      link: tx(s.settled.url, s.settled.tx),
      state: s.settled.done ? "done" : s.resolved.done ? "now" : "later",
      tone: p.status === "paid_out" ? "paid" : undefined,
    });
  }

  return (
    <article className="rounded-lg border border-line bg-surface px-5 pb-2 pt-4">
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <h3 className="font-display text-md font-semibold tracking-tight">
            Policy No. {p.policyId}
            <span className="ml-3 align-middle font-mono text-xs font-normal text-fg-2">{p.instrumentSymbol}</span>
          </h3>
          <p className="num mt-0.5 text-sm text-fg-2">
            {p.marketTitle ?? "Gemini market"} · pays if {side} · {usdc(p.premiumUsdc)} USDC for {usdc(p.payoutUsdc)} USDC
          </p>
        </div>
        <Status tone={st.tone}>{st.label}</Status>
      </header>

      <ol className="mt-3">
        {rows.map((r, i) => (
          <li
            key={i}
            className={cx(
              "grid grid-cols-[1.25rem_1fr] gap-x-3 gap-y-0.5 border-t border-line py-2.5 text-sm sm:grid-cols-[9.5rem_1.25rem_9.5rem_1fr_auto] sm:items-baseline",
              r.state === "later" && "text-fg-3",
            )}
          >
            <span className="num col-start-2 font-mono text-xs text-fg-2 sm:col-start-1 sm:row-start-1">
              {r.time ? stamp(r.time) : r.state === "done" ? "…" : "—"}
            </span>
            <span className="row-span-3 row-start-1 flex justify-center pt-0.5 sm:row-span-1 sm:col-start-2 sm:pt-0">
              <Mark state={r.state} tone={r.tone} />
            </span>
            <span
              className={cx(
                "col-start-2 font-medium sm:col-start-3 sm:row-start-1",
                r.tone === "paid" && "text-up",
                r.tone === "refund" && "text-warn",
                r.state === "failed" && "text-down",
              )}
            >
              {r.title}
            </span>
            <span className={cx("col-start-2 sm:col-start-4 sm:row-start-1", r.state !== "later" && "text-fg-2")}>{r.detail}</span>
            <span className="col-start-2 text-xs sm:col-start-5 sm:row-start-1 sm:text-right">{r.link}</span>
          </li>
        ))}
      </ol>
    </article>
  );
}

function Mark({ state, tone }: { state: Row["state"]; tone?: Row["tone"] }) {
  if (state === "now") return <Spinner className="size-3.5 text-fg" />;
  if (state === "later") return <span className="size-2.5 rounded-full border border-fg-3" />;
  if (state === "failed") return <span className="size-2.5 rounded-full bg-down" />;
  return (
    <span
      className={cx("settle size-2.5 rounded-full", tone === "paid" ? "bg-up" : tone === "refund" ? "bg-warn" : "bg-fg")}
    />
  );
}
