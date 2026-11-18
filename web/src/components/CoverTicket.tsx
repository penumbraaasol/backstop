"use client";

import { useEffect, useState } from "react";
import { useChainId, useConnection } from "wagmi";
import type { Market, Outcome } from "@/lib/api";
import { arcTestnet } from "@/lib/chain";
import { useBackendConfig, useBuyCover, useNow, useStats, useUsdcBalance } from "@/lib/hooks";
import { ConnectButton, useMounted } from "./ConnectButton";
import { ScheduleView, type WalletState } from "./ScheduleView";

/** Wires the policy schedule to the wallet, the backend and the contract. Presentation lives in ScheduleView. */
export function CoverTicket({
  market,
  marketsLoading,
  outcome,
  setOutcome,
}: {
  market?: Market;
  marketsLoading?: boolean;
  outcome: Outcome;
  setOutcome: (o: Outcome) => void;
}) {
  const mounted = useMounted();
  const now = useNow();
  const { isConnected } = useConnection();
  const chainId = useChainId();
  const { data: conf } = useBackendConfig();
  const { data: stats } = useStats();
  const { data: balRaw } = useUsdcBalance();
  const { step, error, result, quoteExpiry, buy, reset } = useBuyCover();
  const [payout, setPayout] = useState(2);

  const maxPayout = stats
    ? Math.max(
        1,
        Math.floor(Math.min(Number(stats.maxPayoutUsdc), Number(stats.freeLiquidityUsdc), Number(stats.maxExposurePerMarketUsdc))),
      )
    : 5;
  useEffect(() => setPayout((p) => Math.min(Math.max(1, p), maxPayout)), [maxPayout]);

  // a new selection clears a finished or failed purchase
  useEffect(() => {
    if (step === "done" || step === "error") reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market?.instrumentSymbol, outcome]);

  const wallet: WalletState = !mounted
    ? "loading"
    : !isConnected
      ? "disconnected"
      : chainId !== arcTestnet.id
        ? "wrong-chain"
        : "ready";

  return (
    <ScheduleView
      market={market}
      marketsLoading={marketsLoading}
      outcome={outcome}
      setOutcome={setOutcome}
      payout={payout}
      setPayout={setPayout}
      maxPayout={maxPayout}
      spread={conf?.spread ?? 0.03}
      now={now}
      wallet={wallet}
      balance={balRaw !== undefined ? Number(balRaw) / 1e6 : undefined}
      step={step}
      error={error}
      result={result}
      quoteExpiry={quoteExpiry}
      onBuy={() => market && buy(market, outcome, payout)}
      onReset={reset}
      connectSlot={<ConnectButton block />}
    />
  );
}
