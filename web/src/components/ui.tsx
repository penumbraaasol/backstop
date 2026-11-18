"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Wordmark() {
  return <span className="font-serif text-lg font-semibold tracking-tight">Backstop</span>;
}

/** A thin ring with one moving arc: a quiet, ink-coloured loading mark. */
export function Spinner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cx("size-4 animate-spin", className)} aria-hidden>
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" />
      <path d="M8 1.5a6.5 6.5 0 0 1 6.5 6.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

type Variant = "primary" | "secondary" | "quiet";

export function Button({
  variant = "primary",
  loading,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={cx(
        "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-md px-4 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed",
        variant === "primary" && "bg-accent text-accent-ink hover:bg-[#17482f] disabled:bg-rule disabled:text-ink-2",
        variant === "secondary" &&
          "border border-ink bg-transparent text-ink hover:bg-paper-sunk disabled:border-rule disabled:text-ink-3",
        variant === "quiet" && "px-2 text-ink-2 underline-offset-4 hover:text-ink hover:underline",
        className,
      )}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export type Tone = "paid" | "pending" | "neutral" | "danger" | "active";

/** Status shown as a word with a small square marker. Colour only where it carries meaning. */
export function Status({ tone, children }: { tone: Tone; children: ReactNode }) {
  const color = {
    paid: "text-accent",
    pending: "text-pending",
    neutral: "text-ink-2",
    danger: "text-danger",
    active: "text-ink",
  }[tone];
  return (
    <span className={cx("inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.08em]", color)}>
      <span className="size-[7px] bg-current" />
      {children}
    </span>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-xs font-medium uppercase tracking-[0.12em] text-ink-2">{children}</p>;
}

export function Ticker({ asset }: { asset: string }) {
  return (
    <span className="inline-flex w-12 shrink-0 justify-center rounded-sm border border-rule bg-paper-raised py-0.5 font-mono text-xs font-medium text-ink">
      {asset || "—"}
    </span>
  );
}

export function ExtLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cx("underline decoration-rule decoration-1 underline-offset-[3px] hover:decoration-ink", className)}
    >
      {children}
    </a>
  );
}
