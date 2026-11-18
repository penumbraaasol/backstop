"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
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

export function TrackedPolicy({ p }: { p: PolicyTimeline }) {
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
    <section className="mx-auto max-w-[1240px] px-5 pb-20 pt-12 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <Eyebrow>My cover</Eyebrow>
          <h1 className="mt-3 font-display text-xl font-semibold tracking-[-0.03em]">Cover you&apos;ve bought</h1>
          <p className="mt-2 max-w-xl text-sm text-fg-2">
            Every policy bought from this wallet, tracked from purchase until it pays out or is refunded. Each step links to
            its transaction on Arc or its order on Gemini.
          </p>
        </div>
        {policies && policies.length > 0 && <Totals policies={policies} />}
      </div>

      <div className="mt-10 space-y-12">
        {!mounted ? (
          <div className="placeholder h-40" />
        ) : !isConnected ? (
          <div className="flex flex-wrap items-center justify-between gap-4 border-y border-line py-8">
            <p className="text-fg-2">Connect your wallet to see the cover you&apos;ve bought.</p>
            <ConnectButton />
          </div>
        ) : isLoading ? (
          <div className="placeholder h-40" />
        ) : !policies?.length ? (
          <div className="border-y border-line py-8">
            <p className="font-medium">Nothing bought yet.</p>
            <p className="mt-1 text-sm text-fg-2">A policy appears here a few seconds after you buy it.</p>
          </div>
        ) : (
          <PolicyList policies={policies} />
        )}
      </div>
    </section>
  );
}

function PolicyList({ policies }: { policies: PolicyTimeline[] }) {
  const [showRefunded, setShowRefunded] = useState(false);
  const refunded = policies.filter((p) => p.status === "refunded").length;
  const list = showRefunded ? policies : policies.filter((p) => p.status !== "refunded");
  return (
    <>
      {list.map((p) => (
        <TrackedPolicy key={p.policyId} p={p} />
      ))}
      {refunded > 0 && (
        <button onClick={() => setShowRefunded((s) => !s)} className="text-xs text-fg-3 underline-offset-4 hover:text-fg hover:underline">
          {showRefunded ? "Hide" : "Show"} {refunded} refunded {refunded === 1 ? "policy" : "policies"}
        </button>
      )}
    </>
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
