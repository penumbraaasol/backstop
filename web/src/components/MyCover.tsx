"use client";

import { useQuery } from "@tanstack/react-query";
import { useConnection } from "wagmi";
import type { PolicyTimeline } from "@/lib/api";
import { publicClient } from "@/lib/chain";
import { usdc } from "@/lib/format";
import { usePolicies } from "@/lib/hooks";
import { ConnectButton, useMounted } from "./ConnectButton";
import { PolicyEntry } from "./PolicyEntry";
import { Eyebrow } from "./ui";

/** Block time of a transaction on Arc (unix seconds). Cached forever: it never changes. */
function useTxTime(hash?: string | null) {
  return useQuery({
    queryKey: ["txTime", hash],
    enabled: !!hash,
    staleTime: Infinity,
    queryFn: async () => {
      const r = await publicClient.getTransactionReceipt({ hash: hash as `0x${string}` });
      const b = await publicClient.getBlock({ blockNumber: r.blockNumber });
      return Number(b.timestamp);
    },
  }).data;
}

function TrackedPolicy({ p }: { p: PolicyTimeline }) {
  const purchased = useTxTime(p.steps.purchased.tx);
  const resolved = useTxTime(p.steps.resolved.tx);
  const settled = useTxTime(p.steps.settled.tx);
  return <PolicyEntry p={p} times={{ purchased, resolved, settled }} />;
}

export function MyCover() {
  const mounted = useMounted();
  const { address, isConnected } = useConnection();
  const { data: policies, isLoading } = usePolicies(address);

  return (
    <section id="policies" className="mx-auto max-w-[1240px] px-5 py-20 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <Eyebrow>My policies</Eyebrow>
          <h2 className="mt-3 font-display text-xl font-semibold tracking-[-0.03em]">Every policy, step by step</h2>
          <p className="mt-2 max-w-xl text-sm text-fg-2">
            Each step links to its transaction on Arc or its order on Gemini, so you can check it yourself.
          </p>
        </div>
        {policies && policies.length > 0 && <Totals policies={policies} />}
      </div>

      <div className="mt-10 space-y-12">
        {!mounted ? (
          <div className="placeholder h-40" />
        ) : !isConnected ? (
          <div className="flex flex-wrap items-center justify-between gap-4 border-y border-line py-8">
            <p className="text-fg-2">Connect your wallet to see the policies you&apos;ve bought.</p>
            <ConnectButton />
          </div>
        ) : isLoading ? (
          <div className="placeholder h-40" />
        ) : !policies?.length ? (
          <div className="border-y border-line py-8">
            <p className="font-display text-md">No policies yet.</p>
            <p className="mt-1 text-sm text-fg-2">A policy appears here a few seconds after you buy it.</p>
          </div>
        ) : (
          policies.map((p) => <TrackedPolicy key={p.policyId} p={p} />)
        )}
      </div>
    </section>
  );
}

function Totals({ policies }: { policies: PolicyTimeline[] }) {
  const active = policies.filter((p) => p.status === "active").length;
  const paid = policies.filter((p) => p.status === "paid_out").reduce((s, p) => s + Number(p.payoutUsdc), 0);
  return (
    <dl className="flex gap-10 text-sm">
      <div>
        <dt className="text-xs text-fg-2">Open</dt>
        <dd className="num font-display text-lg">{active}</dd>
      </div>
      <div>
        <dt className="text-xs text-fg-2">Paid out to you</dt>
        <dd className="num font-display text-lg text-up">{usdc(paid)} USDC</dd>
      </div>
    </dl>
  );
}
