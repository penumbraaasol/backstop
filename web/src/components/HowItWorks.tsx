import { BadgeCheck, CircleDollarSign, LineChart, RotateCcw, ShieldCheck, Undo2 } from "lucide-react";
import { SectionHeading } from "./ui";

const STEPS = [
  {
    icon: LineChart,
    title: "Priced by the market",
    body: "Your premium comes from Gemini's live order book: N × (p + s). p is the best ask for your outcome; s is a 3¢ spread.",
  },
  {
    icon: CircleDollarSign,
    title: "Pay once, in USDC",
    body: "Arc uses USDC for gas and settlement, so one balance covers everything. The contract locks your full payout up front.",
  },
  {
    icon: ShieldCheck,
    title: "Hedged on Gemini",
    body: "Backstop buys N contracts of your outcome on Gemini, so every policy is backed one-for-one. There's no underwriting pool.",
  },
  {
    icon: BadgeCheck,
    title: "Paid out automatically",
    body: "When Gemini resolves the market, the resolver posts the result onchain and the contract pays you N USDC if your outcome happened.",
  },
];

const GUARANTEES = [
  { icon: Undo2, text: "Hedge didn't fill? Your premium is refunded automatically." },
  { icon: RotateCcw, text: "Backend offline? Claim your premium back yourself 24 h after the deadline." },
  { icon: ShieldCheck, text: "Locked payouts can't be withdrawn by the operator, ever." },
];

export function HowItWorks() {
  return (
    <section id="how" className="relative border-y border-line bg-surface/50">
      <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8">
        <SectionHeading
          eyebrow="How it works"
          title="Insurance logic, prediction-market pricing."
          sub="The prediction market is both the price oracle and the reinsurer, so cover is priced fairly and always backed."
        />
        <ol className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="card group p-6 transition hover:border-line-strong">
              <div className="flex items-center justify-between">
                <span className="flex size-10 items-center justify-center rounded-xl bg-mint/10 text-mint ring-1 ring-mint/20">
                  <s.icon className="size-5" />
                </span>
                <span className="font-mono text-xs text-faint">0{i + 1}</span>
              </div>
              <h3 className="mt-5 font-semibold tracking-tight">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
            </li>
          ))}
        </ol>

        <div className="mt-6 grid gap-4 lg:grid-cols-[1.1fr_1fr]">
          <div className="card p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-faint">Worked example</p>
            <div className="mt-4 grid grid-cols-3 gap-3 text-center">
              <Figure k="Cover (N)" v="$100" />
              <Figure k="Gemini ask (p)" v="0.27" />
              <Figure k="Spread (s)" v="0.03" />
            </div>
            <div className="mt-4 rounded-xl bg-black/25 px-4 py-3 text-center font-mono text-sm">
              100 × (0.27 + 0.03) = <span className="text-mint">$30 premium</span>
            </div>
            <p className="mt-3 text-sm text-muted">
              $27 buys 100 contracts on Gemini and $3 is the protocol margin. If the event happens, the contracts pay
              $100, which funds your $100 payout.
            </p>
          </div>
          <div className="card p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-faint">Built-in protections</p>
            <ul className="mt-4 space-y-3">
              {GUARANTEES.map((g) => (
                <li key={g.text} className="flex items-start gap-3 text-sm">
                  <g.icon className="mt-0.5 size-4 shrink-0 text-mint" />
                  <span className="text-fg/90">{g.text}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

function Figure({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-xl border border-line bg-white/[0.02] p-3">
      <p className="text-[11px] text-faint">{k}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{v}</p>
    </div>
  );
}
