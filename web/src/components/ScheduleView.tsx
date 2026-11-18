"use client";

import { Check, Minus, Plus } from "lucide-react";
import type { ReactNode } from "react";
import type { Market, Outcome } from "@/lib/api";
import { FAUCET_URL, txUrl } from "@/lib/chain";
import { condition, countdown, previewPremium, sideText, timeOfDay, usdc } from "@/lib/format";
import type { BuyResult, BuyStep } from "@/lib/hooks";
import { Button, cx, ExtLink, Spinner } from "./ui";

export type WalletState = "loading" | "disconnected" | "wrong-chain" | "ready";

export type ScheduleProps = {
  market?: Market;
  marketsLoading?: boolean;
  outcome: Outcome;
  setOutcome: (o: Outcome) => void;
  payout: number;
  setPayout: (n: number) => void;
  maxPayout: number;
  spread: number;
  now: number;
  wallet: WalletState;
  balance?: number;
  step: BuyStep;
  error?: string;
  result?: BuyResult;
  quoteExpiry?: number;
  onBuy: () => void;
  onReset: () => void;
  connectSlot: ReactNode;
};

const PRESETS = [1, 2, 5];
const BUSY: BuyStep[] = ["switch", "quote", "approve", "buy", "confirm"];

export function ScheduleView(props: ScheduleProps) {
  const { market, marketsLoading, outcome, setOutcome, payout, setPayout, maxPayout, spread, now } = props;
  const { wallet, balance, step, error, result, quoteExpiry, onBuy, onReset, connectSlot } = props;

  return (
    <section aria-label="Policy schedule" className="rounded-lg border border-line bg-surface px-5 pb-5">
      <div className="flex items-baseline justify-between pb-2.5 pt-3">
        <h2 className="font-display text-md font-semibold tracking-tight">Your cover</h2>
        <span className="font-mono text-xs text-fg-2">
          {result ? `No. ${result.policyId}` : "Draft"}
        </span>
      </div>

      {!market ? (
        marketsLoading ? (
          <div className="space-y-3 border-t border-line py-6">
            <div className="placeholder h-5 w-3/4" />
            <div className="placeholder h-16" />
            <div className="placeholder h-24" />
          </div>
        ) : (
          <div className="border-t border-line py-12">
            <p className="font-medium">Choose a market to start.</p>
            <p className="mt-1 text-sm text-fg-2">
              Pick a row in the table, then the YES or NO price for the outcome that should pay you.
            </p>
          </div>
        )
      ) : (
        <Filled {...props} market={market} />
      )}

      {market && (
        <div className="border-t border-line pt-3">
          {wallet === "loading" ? (
            <div className="placeholder h-12" />
          ) : wallet !== "ready" ? (
            connectSlot
          ) : step === "done" && result ? (
            <Issued result={result} onReset={onReset} />
          ) : BUSY.includes(step) ? (
            <Progress step={step} quoteExpiry={quoteExpiry} now={now} />
          ) : (
            <BuyButton {...props} market={market} />
          )}
          {error && step === "error" && (
            <p role="alert" className="mt-3 border-l-2 border-down pl-3 text-sm text-down">
              {error}
            </p>
          )}
          {wallet === "ready" && balance !== undefined && step !== "done" && (
            <p className="num mt-2 text-xs text-fg-2">Wallet balance: {usdc(balance)} USDC (gas is also paid in USDC)</p>
          )}
        </div>
      )}

      {market && (
        <ul className="mt-5 space-y-1 border-t border-line pt-4 text-xs leading-relaxed text-fg-2">
          <li>The price is fixed for 60 seconds once you press buy.</li>
          <li>If the hedge order on Gemini doesn&apos;t fill, the premium is returned to you automatically.</li>
          <li>Settled from Gemini&apos;s official result for this market, shortly after {timeOfDay(market.expiry)}.</li>
        </ul>
      )}
    </section>
  );
}


function Filled(props: ScheduleProps & { market: Market }) {
  const { market, outcome, setOutcome, payout, setPayout, maxPayout, spread, now, step } = props;
  const busy = BUSY.includes(step);
  const left = Math.floor((new Date(market.expiry).getTime() - now) / 1000);
  const price = outcome === "yes" ? market.askYes : market.askNo;
  const q = previewPremium(payout, price, spread);
  return (
    <>
      <Field label="Event">
        <p className="font-medium">{market.title}</p>
        <p className="num text-xs text-fg-2">
          Closes {timeOfDay(market.expiry)} ·{" "}
          <span className={cx("font-mono", left < 120 && "text-warn")}>in {countdown(left)}</span>
        </p>
      </Field>

      <Field label="Pays if">
        <div className="grid gap-1.5" role="radiogroup">
          {(["yes", "no"] as const).map((o) => {
            const on = outcome === o;
            const p = o === "yes" ? market.askYes : market.askNo;
            return (
              <button
                key={o}
                role="radio"
                aria-checked={on}
                disabled={busy}
                onClick={() => setOutcome(o)}
                className={cx(
                  "flex items-center gap-3 rounded-sm border px-3 py-2 text-left transition-colors",
                  on ? "border-fg-3 bg-surface-2" : "border-line hover:border-line-strong",
                )}
              >
                <span
                  className={cx(
                    "flex size-4 shrink-0 items-center justify-center rounded-full border",
                    on ? "border-line-strong bg-fg" : "border-fg-3",
                  )}
                >
                  {on && <span className="size-1.5 rounded-full bg-bg" />}
                </span>
                <span className={cx("w-8 text-xs font-semibold uppercase tracking-[0.08em]", o === "yes" ? "text-up" : "text-down")}>{o}</span>
                <span className="flex-1 text-sm">{sideText(market, o)}</span>
                <span className="num font-mono text-xs text-fg-2">{p.toFixed(2)}</span>
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="Payout">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center rounded-sm border border-line-strong bg-surface-2 focus-within:border-fg-3">
            <button
              aria-label="Decrease payout"
              disabled={busy || payout <= 1}
              onClick={() => setPayout(Math.max(1, payout - 1))}
              className="px-2.5 py-2 text-fg-2 hover:text-fg disabled:opacity-30"
            >
              <Minus className="size-3.5" />
            </button>
            <input
              type="number"
              aria-label="Payout in USDC"
              min={1}
              max={maxPayout}
              step={1}
              value={payout}
              disabled={busy}
              onChange={(e) => {
                const v = Math.floor(Number(e.target.value));
                if (!Number.isNaN(v)) setPayout(Math.min(Math.max(1, v), maxPayout));
              }}
              className="num w-12 bg-transparent text-center text-lg font-semibold outline-none"
            />
            <button
              aria-label="Increase payout"
              disabled={busy || payout >= maxPayout}
              onClick={() => setPayout(Math.min(maxPayout, payout + 1))}
              className="px-2.5 py-2 text-fg-2 hover:text-fg disabled:opacity-30"
            >
              <Plus className="size-3.5" />
            </button>
          </div>
          <span className="text-sm text-fg-2">USDC</span>
          <span className="ml-auto flex gap-3 text-xs">
            {PRESETS.filter((x) => x <= maxPayout).map((x) => (
              <button
                key={x}
                disabled={busy}
                onClick={() => setPayout(x)}
                className={cx("num font-mono", payout === x ? "text-fg underline underline-offset-4" : "text-fg-2 hover:text-fg")}
              >
                {x}
              </button>
            ))}
          </span>
        </div>
        <p className="mt-1.5 text-xs text-fg-2">Testnet limit: {maxPayout} USDC per policy.</p>
      </Field>

      {/* the receipt */}
      <div className="border-t border-line-strong py-3">
        <div className="space-y-1.5 text-sm">
          <Leader label="Payout" value={`${usdc(payout)} USDC`} />
          <Leader label={`Gemini price, ${outcome.toUpperCase()}`} value={`× ${price.toFixed(2)}`} />
          <Leader label="Backstop spread" value={`+ ${spread.toFixed(2)}`} />
        </div>
        <div className="mt-3 flex items-baseline justify-between gap-4 border-t border-line-strong pt-3">
          <span className="text-sm font-medium">You pay</span>
          <span className="num font-display text-xl font-semibold tracking-[-0.03em]">
            {q.valid ? usdc(q.premium) : "—"} <span className="text-md text-fg-2">USDC</span>
          </span>
        </div>
        <p className="num mt-1 text-right font-mono text-xs text-fg-2">
          {payout} × ({price.toFixed(2)} + {spread.toFixed(2)}) = {usdc(q.premium)}
        </p>
        {q.valid ? (
          <p className="mt-3 text-md leading-snug">
            You pay <b className="num font-semibold">{usdc(q.premium)} USDC</b>. If {condition(market, outcome)}, you get <b className="num font-semibold">{usdc(payout)} USDC</b>.
          </p>
        ) : (
          <p className="mt-4 text-sm text-fg-2">
            This side costs more than it pays once the spread is added, so it can&apos;t be covered right now.
          </p>
        )}
        {q.valid && (
          <p className="num mt-1.5 text-xs text-fg-2">
            {usdc(q.hedge)} buys {payout} {outcome.toUpperCase()} contracts on Gemini as the hedge. {usdc(q.margin)} is
            the spread.
          </p>
        )}
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] gap-3 border-t border-line py-2.5">
      <span className="pt-0.5 text-xs text-fg-2">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Leader({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="leader">
      <span className={cx(strong ? "font-medium" : "text-fg-2")}>{label}</span>
      <span className="dots" />
      <span className={cx("num font-mono", strong && "font-medium")}>{value}</span>
    </div>
  );
}

function BuyButton({ market, outcome, payout, spread, now, balance, onBuy }: ScheduleProps & { market: Market }) {
  const price = outcome === "yes" ? market.askYes : market.askNo;
  const q = previewPremium(payout, price, spread);
  const closed = (new Date(market.expiry).getTime() - now) / 1000 <= 45;
  const short = balance !== undefined && balance < q.premium + 0.02;
  if (short)
    return (
      <div>
        <Button variant="secondary" className="w-full py-3" disabled>
          Not enough USDC for this policy
        </Button>
        <p className="mt-2 text-xs text-fg-2">
          Get testnet USDC from <ExtLink href={FAUCET_URL}>faucet.circle.com</ExtLink> (choose Arc Testnet).
        </p>
      </div>
    );
  return (
    <Button className="w-full py-3 text-md" disabled={!q.valid || closed} onClick={onBuy}>
      {closed ? "This market is about to close" : !q.valid ? "Not available" : `Buy cover for ${usdc(q.premium)} USDC`}
    </Button>
  );
}

const STEPS: { id: BuyStep; label: string; hint: string }[] = [
  { id: "quote", label: "Fix the price", hint: "Backend signs a quote" },
  { id: "approve", label: "Approve USDC", hint: "Confirm in your wallet" },
  { id: "buy", label: "Buy the policy", hint: "Confirm in your wallet" },
  { id: "confirm", label: "Recorded on Arc", hint: "Waiting for the block" },
];

export function Progress({ step, quoteExpiry, now }: { step: BuyStep; quoteExpiry?: number; now: number }) {
  const idx = step === "switch" ? -1 : STEPS.findIndex((s) => s.id === step);
  const ttl = quoteExpiry ? Math.max(0, Math.floor((quoteExpiry - now) / 1000)) : null;
  return (
    <div aria-live="polite">
      {step === "switch" && <p className="mb-2 text-sm text-warn">Switch your wallet to Arc Testnet to continue.</p>}
      <ol className="text-sm">
        {STEPS.map((s, i) => {
          const done = i < idx;
          const cur = i === idx;
          return (
            <li key={s.id} className="flex items-center gap-3 border-b border-line py-2.5 last:border-b-0">
              <span
                className={cx(
                  "flex size-5 shrink-0 items-center justify-center rounded-full text-[11px]",
                  done && "settle bg-fg text-bg",
                  cur && "text-fg",
                  !done && !cur && "border border-line text-fg-3",
                )}
              >
                {done ? <Check className="size-3" strokeWidth={3} /> : cur ? <Spinner /> : i + 1}
              </span>
              <span className={cx(cur || done ? "text-fg" : "text-fg-3", cur && "font-medium")}>{s.label}</span>
              <span className="num ml-auto font-mono text-xs text-fg-2">
                {s.id === "quote" && done && ttl !== null ? `price held ${ttl}s` : cur ? s.hint : ""}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Issued({ result, onReset }: { result: BuyResult; onReset: () => void }) {
  return (
    <div className="settle">
      <p className="flex items-center gap-2 text-sm font-medium text-up">
        <span className="flex size-5 items-center justify-center rounded-full bg-up text-primary-fg">
          <Check className="size-3" strokeWidth={3} />
        </span>
        Policy No. {result.policyId} issued
      </p>
      <p className="mt-2 text-md">
        You paid <b className="num font-semibold">{usdc(result.premiumUsdc)} USDC</b> for{" "}
        <b className="num font-semibold">{usdc(result.payoutUsdc)} USDC</b> of cover. The hedge order is being placed on
        Gemini now.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
        <a href="#policies" className="font-medium underline underline-offset-4">
          Track this policy ↓
        </a>
        <ExtLink href={txUrl(result.txHash)} className="text-fg-2">
          Purchase transaction ↗
        </ExtLink>
        <button onClick={onReset} className="ml-auto text-fg-2 hover:text-fg">
          Buy another
        </button>
      </div>
    </div>
  );
}
