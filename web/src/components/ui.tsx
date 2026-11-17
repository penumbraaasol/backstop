"use client";

import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-2.5", className)}>
      <svg viewBox="0 0 32 32" className="size-7" aria-hidden>
        <defs>
          <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#3ee6b0" />
            <stop offset="1" stopColor="#8b7bff" />
          </linearGradient>
        </defs>
        <path d="M16 3.5 26.5 7.6v7.7c0 6.3-4.3 11-10.5 12.9C9.8 26.3 5.5 21.6 5.5 15.3V7.6L16 3.5Z" fill="url(#lg)" />
        <path d="m11.3 15.9 3.4 3.4 6.2-6.7" fill="none" stroke="#06070a" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="text-[17px] font-semibold tracking-tight">Backstop</span>
    </span>
  );
}

type Variant = "primary" | "secondary" | "ghost";

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
        "inline-flex select-none items-center whitespace-nowrap justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all duration-200",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mint disabled:cursor-not-allowed",
        variant === "primary" &&
          "bg-mint text-ink shadow-[0_8px_30px_-8px_rgb(62_230_176/0.6)] hover:bg-[#5cf0c1] hover:shadow-[0_10px_36px_-8px_rgb(62_230_176/0.75)] active:scale-[0.98] disabled:bg-raised disabled:text-faint disabled:shadow-none",
        variant === "secondary" &&
          "border border-line-strong bg-white/[0.04] text-fg hover:bg-white/[0.08] active:scale-[0.98] disabled:opacity-50",
        variant === "ghost" && "text-muted hover:bg-white/5 hover:text-fg",
        className,
      )}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Badge({
  tone = "neutral",
  children,
  className,
  dot,
}: {
  tone?: "neutral" | "mint" | "yes" | "no" | "warn" | "violet";
  children: ReactNode;
  className?: string;
  dot?: boolean;
}) {
  const tones = {
    neutral: "bg-white/[0.06] text-muted ring-white/10",
    mint: "bg-mint/10 text-mint ring-mint/25",
    yes: "bg-yes/10 text-yes ring-yes/25",
    no: "bg-no/10 text-no ring-no/25",
    warn: "bg-warn/10 text-warn ring-warn/25",
    violet: "bg-violet/10 text-violet ring-violet/25",
  };
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
        tones[tone],
        className,
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function LiveDot({ className }: { className?: string }) {
  return (
    <span className={cx("relative inline-flex size-2", className)}>
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-mint opacity-60" />
      <span className="relative inline-flex size-2 rounded-full bg-mint" />
    </span>
  );
}

const ASSET_COLORS: Record<string, string> = {
  BTC: "from-[#f7931a] to-[#ffb347]",
  ETH: "from-[#627eea] to-[#a5b4fc]",
  SOL: "from-[#9945ff] to-[#14f195]",
  XRP: "from-[#9ca3af] to-[#e5e7eb]",
  HYPE: "from-[#3ee6b0] to-[#0ea5e9]",
  ZEC: "from-[#f4b728] to-[#fde68a]",
};

export function AssetIcon({ asset, src, size = 36 }: { asset: string; src?: string | null; size?: number }) {
  return (
    <span
      className={cx(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-linear-to-br text-[11px] font-bold text-ink ring-1 ring-white/10",
        ASSET_COLORS[asset] ?? "from-white/30 to-white/10",
      )}
      style={{ width: size, height: size }}
    >
      {asset.slice(0, 3)}
      {src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          className="absolute inset-0 size-full object-cover"
          onError={(e) => (e.currentTarget.style.display = "none")}
        />
      )}
    </span>
  );
}

export function SectionHeading({ eyebrow, title, sub }: { eyebrow: string; title: ReactNode; sub?: ReactNode }) {
  return (
    <div className="max-w-2xl">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-mint">{eyebrow}</p>
      <h2 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{title}</h2>
      {sub && <p className="mt-3 text-pretty text-muted">{sub}</p>}
    </div>
  );
}
