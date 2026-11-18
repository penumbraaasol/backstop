"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

/**
 * The Backstop mark: a position (the square) held between two sides.
 * The white bracket is the buyer's cover, the green one the offsetting Gemini hedge.
 */
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <path d="M4 9 V28 H23" fill="none" stroke="var(--color-fg)" strokeWidth="4" strokeLinecap="square" />
      <path d="M9 4 H28 V23" fill="none" stroke="var(--color-up)" strokeWidth="4" strokeLinecap="square" />
      <rect x="12.5" y="12.5" width="7" height="7" fill="var(--color-fg)" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2.5">
      <Mark className="size-[22px]" />
      <span className="font-display text-[19px] font-semibold tracking-[-0.03em]">Backstop</span>
    </span>
  );
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
        "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-md px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed",
        variant === "primary" && "bg-primary text-primary-fg hover:bg-white/85 active:bg-white/75 disabled:bg-surface-2 disabled:text-fg-3",
        variant === "secondary" &&
          "border border-line-strong bg-transparent text-fg hover:bg-surface-2 disabled:border-line disabled:text-fg-3",
        variant === "quiet" && "px-2 text-fg-2 underline-offset-4 hover:text-fg hover:underline",
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
    paid: "text-up",
    pending: "text-warn",
    neutral: "text-fg-2",
    danger: "text-down",
    active: "text-fg",
  }[tone];
  return (
    <span className={cx("inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.08em]", color)}>
      <span className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-xs font-medium uppercase tracking-[0.12em] text-fg-2">{children}</p>;
}

export function Ticker({ asset }: { asset: string }) {
  return (
    <span className="inline-flex w-12 shrink-0 justify-center rounded-sm bg-surface-2 py-1 font-mono text-xs font-medium text-fg">
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
      className={cx("underline decoration-line-strong decoration-1 underline-offset-[3px] hover:decoration-fg", className)}
    >
      {children}
    </a>
  );
}
