"use client";

import { useQuery } from "@tanstack/react-query";
import { api, type AgentAction } from "@/lib/api";
import { addressUrl } from "@/lib/chain";
import { shortAddr, stamp } from "@/lib/format";
import { useBackendConfig, usePolicies } from "@/lib/hooks";
import { TrackedPolicy } from "./MyCover";
import { cx, Eyebrow, ExtLink, Status, type Tone } from "./ui";

/** The Grok agent's own wallet, limits, decision log and the policies it bought. */
export function AgentSection() {
  const { data: conf } = useBackendConfig();
  const { data: a } = useQuery({
    queryKey: ["agent"],
    queryFn: api.agent,
    enabled: !!conf?.agent,
    refetchInterval: 5_000,
  });
  const { data: policies } = usePolicies(a?.address ?? undefined);
  if (!conf?.agent || !a) return null;

  const spent = Number(a.spentTodayUsdc);
  const budget = Number(a.dailyBudgetUsdc);
  const byPolicy = new Map((policies ?? []).map((p) => [p.policyId, p]));

  return (
    <section id="agent" className="mx-auto max-w-[1240px] px-5 py-20 sm:px-8">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div>
          <Eyebrow>Grok agent</Eyebrow>
          <h2 className="mt-3 font-display text-xl font-semibold tracking-[-0.03em]">An AI that buys cover with its own wallet</h2>
          <p className="mt-2 max-w-md text-sm text-fg-2">
            Press &quot;Let Grok buy it&quot; and Grok picks the policy. The agent wallet then signs the purchase on Arc with
            no human approval. Its limits are enforced by the backend, and every decision is logged below.
          </p>

          <dl className="mt-8 divide-y divide-line rounded-lg border border-line bg-surface text-sm">
            <Row k="Agent wallet">
              <ExtLink href={addressUrl(a.address!)} className="font-mono">
                {shortAddr(a.address!)} ↗
              </ExtLink>
            </Row>
            <Row k="Balance">
              <span className="num font-semibold">{a.balanceUsdc} USDC</span>
            </Row>
            <Row k="Spent today">
              <span className="num">
                {a.spentTodayUsdc} / {a.dailyBudgetUsdc} USDC
              </span>
              <span className="mt-1.5 block h-1 w-full overflow-hidden rounded-full bg-surface-2">
                <span
                  className={cx("block h-full rounded-full", spent / budget > 0.8 ? "bg-warn" : "bg-fg-2")}
                  style={{ width: `${Math.min(100, (spent / budget) * 100)}%` }}
                />
              </span>
            </Row>
            <Row k="Max per policy">
              <span className="num">{a.maxPayoutUsdc} USDC payout</span>
            </Row>
            <Row k="Model">
              <span className="font-mono text-xs">{a.model}</span>
            </Row>
          </dl>
        </div>

        <div>
          <h3 className="text-sm font-semibold tracking-tight">Decision log</h3>
          {a.actions.length === 0 ? (
            <p className="mt-3 border-y border-line py-8 text-sm text-fg-2">
              No decisions yet. Describe a risk above and press &quot;Let Grok buy it&quot;.
            </p>
          ) : (
            <ol className="mt-3 space-y-3">
              {a.actions.slice(0, 6).map((x) => (
                <Decision key={x.id} x={x} />
              ))}
            </ol>
          )}
        </div>
      </div>

      {a.actions.some((x) => x.policyId && byPolicy.has(x.policyId)) && (
        <div className="mt-14">
          <h3 className="text-sm font-semibold tracking-tight">Policies the agent bought</h3>
          <div className="mt-4 space-y-6">
            {a.actions
              .filter((x) => x.policyId && byPolicy.has(x.policyId))
              .slice(0, 3)
              .map((x) => (
                <TrackedPolicy key={x.id} p={byPolicy.get(x.policyId!)!} />
              ))}
          </div>
        </div>
      )}
    </section>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] items-start gap-3 px-4 py-3">
      <dt className="text-xs text-fg-2">{k}</dt>
      <dd>{children}</dd>
    </div>
  );
}

const STATUS: Record<AgentAction["status"], { tone: Tone; label: string }> = {
  bought: { tone: "paid", label: "Bought" },
  declined: { tone: "neutral", label: "Declined" },
  blocked: { tone: "pending", label: "Blocked by limits" },
  failed: { tone: "danger", label: "Failed" },
};

function Decision({ x }: { x: AgentAction }) {
  const st = STATUS[x.status];
  return (
    <li className="rounded-lg border border-line bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Status tone={st.tone}>{st.label}</Status>
        <span className="num font-mono text-xs text-fg-3">{stamp(x.at)}</span>
      </div>
      <p className="mt-2 text-sm text-fg-2">&ldquo;{x.instruction}&rdquo;</p>
      <p className="mt-1.5 text-sm font-medium">{x.summary}</p>
      <p className="mt-0.5 text-sm text-fg-2">{x.error ?? x.reasoning}</p>
      {x.status === "bought" && (
        <p className="num mt-2 flex flex-wrap gap-x-4 font-mono text-xs text-fg-2">
          <span>
            policy No. {x.policyId} · {x.premiumUsdc} USDC → {x.payout}.00 USDC
          </span>
          {x.url && <ExtLink href={x.url}>tx {x.tx?.slice(0, 10)}… ↗</ExtLink>}
        </p>
      )}
    </li>
  );
}
