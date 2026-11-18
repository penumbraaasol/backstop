import { Leader } from "./ScheduleView";
import { Eyebrow } from "./ui";

const STEPS = [
  {
    title: "The price comes from Gemini",
    body: "Your premium is N × (p + s). N is the payout in USDC, p is Gemini's best ask for your outcome, and s is a fixed 0.03 spread that covers Gemini's fee and Backstop's margin.",
  },
  {
    title: "You pay once, in USDC, on Arc",
    body: "Arc uses USDC for gas, so one balance covers the premium and the fees. The contract locks the full payout from its treasury before your policy is issued.",
  },
  {
    title: "Backstop buys the matching contracts",
    body: "For every policy, the backend buys N contracts of the same outcome on Gemini. If the event happens, those contracts pay N dollars, which funds your payout.",
  },
  {
    title: "The contract pays you",
    body: "After the market closes, the resolver reads Gemini's official result and posts it on Arc. If your outcome happened, the contract sends you N USDC.",
  },
];

const PROTECTIONS = [
  ["Hedge order doesn't fill", "Your premium is refunded by the contract, automatically."],
  ["Backstop's server goes down", "24 hours after the deadline you can claim your premium back yourself."],
  ["Funds for open policies", "Locked in the contract. The operator can only withdraw unlocked funds."],
  ["Size limits", "Caps per policy and per market limit what any single failure can cost."],
];

export function HowItWorks() {
  return (
    <section>
      <div className="mx-auto grid max-w-[1240px] gap-x-16 gap-y-14 px-5 pb-20 pt-12 sm:px-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div>
          <Eyebrow>How it works</Eyebrow>
          <h1 className="mt-3 max-w-lg font-display text-xl font-semibold tracking-[-0.03em]">
            The prediction market sets the price and carries the risk.
          </h1>
          <ol className="mt-10">
            {STEPS.map((s, i) => (
              <li key={s.title} className="grid grid-cols-[2.5rem_1fr] border-t border-line py-5">
                <span className="num font-display text-lg text-fg-2">{i + 1}</span>
                <div>
                  <h3 className="font-medium">{s.title}</h3>
                  <p className="mt-1 max-w-xl text-fg-2">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="space-y-14 lg:pt-[5.5rem]">
          <div>
            <h3 className="border-b border-line pb-3 font-display text-lg font-semibold tracking-tight">Worked example</h3>
            <div className="mt-4 space-y-1.5 text-sm">
              <Leader label="Payout (N)" value="100.00 USDC" />
              <Leader label="Gemini price (p)" value="× 0.27" />
              <Leader label="Spread (s)" value="+ 0.03" />
            </div>
            <div className="mt-3 flex items-baseline justify-between border-t border-line-strong pt-3">
              <span className="font-medium">Premium</span>
              <span className="num font-display text-lg font-medium">30.00 USDC</span>
            </div>
            <p className="mt-3 text-sm text-fg-2">
              27 USDC buys 100 contracts on Gemini. 3 USDC is the spread. If the event happens, the contracts pay
              100 USD, which covers the 100 USDC payout.
            </p>
          </div>

          <div>
            <h3 className="border-b border-line pb-3 font-display text-lg font-semibold tracking-tight">If something goes wrong</h3>
            <dl className="mt-1">
              {PROTECTIONS.map(([k, v]) => (
                <div key={k} className="border-b border-line py-3">
                  <dt className="font-medium">{k}</dt>
                  <dd className="mt-0.5 text-sm text-fg-2">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </section>
  );
}
