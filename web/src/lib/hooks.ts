"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { BaseError, erc20Abi, parseEventLogs, type Hex } from "viem";
import { useChainId, useConnection, useReadContract, useSwitchChain, useWriteContract } from "wagmi";
import { backstopAbi } from "./abi";
import { api, ApiError, type Market, type Outcome } from "./api";
import { arcTestnet, BACKSTOP_ADDRESS, publicClient, USDC_ADDRESS } from "./chain";

/** A clock that ticks every `ms`, for countdowns. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export const secondsLeft = (m: Pick<Market, "expiry">, now: number) =>
  Math.floor((new Date(m.expiry).getTime() - now) / 1000);

export const useBackendConfig = () => useQuery({ queryKey: ["config"], queryFn: api.config, staleTime: Infinity });
export const useStats = () => useQuery({ queryKey: ["stats"], queryFn: api.stats, refetchInterval: 15_000 });
export const useMarkets = () => useQuery({ queryKey: ["markets"], queryFn: api.markets, refetchInterval: 5_000 });

export function usePolicies(address?: string) {
  return useQuery({
    queryKey: ["policies", address],
    queryFn: () => api.policies(address!),
    enabled: !!address,
    refetchInterval: (q) => (q.state.data?.some((p) => p.status === "active") ? 3_000 : 15_000),
  });
}

export function useUsdcBalance() {
  const { address } = useConnection();
  return useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: arcTestnet.id,
    query: { enabled: !!address, refetchInterval: 10_000 },
  });
}

export type BuyStep = "idle" | "switch" | "quote" | "approve" | "buy" | "confirm" | "done" | "error";

export type BuyResult = { policyId: number; txHash: Hex; premiumUsdc: string; payoutUsdc: string };

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof BaseError) {
    if (/User rejected|denied/i.test(e.shortMessage + e.details)) return "You rejected the request in your wallet.";
    return e.shortMessage;
  }
  return (e as Error)?.message ?? "Something went wrong.";
}

/** quote -> approve (if needed) -> buyPolicy -> receipt, with a visible step for each. */
export function useBuyCover() {
  const qc = useQueryClient();
  const { address } = useConnection();
  const chainId = useChainId();
  const { mutateAsync: switchChain } = useSwitchChain();
  const { mutateAsync: write } = useWriteContract();
  const [step, setStep] = useState<BuyStep>("idle");
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<BuyResult>();
  const [quoteExpiry, setQuoteExpiry] = useState<number>();

  const reset = useCallback(() => {
    setStep("idle");
    setError(undefined);
    setResult(undefined);
    setQuoteExpiry(undefined);
  }, []);

  const buy = useCallback(
    async (market: Market, outcome: Outcome, payout: number) => {
      if (!address) return;
      setError(undefined);
      setResult(undefined);
      try {
        if (chainId !== arcTestnet.id) {
          setStep("switch");
          await switchChain({ chainId: arcTestnet.id });
        }
        setStep("quote");
        const q = await api.quote({
          buyer: address,
          instrumentSymbol: market.instrumentSymbol,
          eventTicker: market.eventTicker,
          outcome,
          payout,
        });
        setQuoteExpiry(Number(q.quote.quoteExpiry) * 1000);
        const quote = {
          buyer: q.quote.buyer,
          marketId: q.quote.marketId,
          outcome: Number(q.quote.outcome),
          payout: BigInt(q.quote.payout),
          premium: BigInt(q.quote.premium),
          quoteExpiry: BigInt(q.quote.quoteExpiry),
          resolveBy: BigInt(q.quote.resolveBy),
          nonce: BigInt(q.quote.nonce),
        };

        const allowance = await publicClient.readContract({
          address: USDC_ADDRESS,
          abi: erc20Abi,
          functionName: "allowance",
          args: [address, BACKSTOP_ADDRESS],
        });
        if (allowance < quote.premium) {
          setStep("approve");
          const h = await write({
            address: USDC_ADDRESS,
            abi: erc20Abi,
            functionName: "approve",
            args: [BACKSTOP_ADDRESS, quote.premium],
            chainId: arcTestnet.id,
          });
          await publicClient.waitForTransactionReceipt({ hash: h });
        }

        setStep("buy");
        await publicClient.simulateContract({
          account: address,
          address: BACKSTOP_ADDRESS,
          abi: backstopAbi,
          functionName: "buyPolicy",
          args: [quote, q.signature, q.instrumentSymbol],
        });
        const hash = await write({
          address: BACKSTOP_ADDRESS,
          abi: backstopAbi,
          functionName: "buyPolicy",
          args: [quote, q.signature, q.instrumentSymbol],
          chainId: arcTestnet.id,
        });
        setStep("confirm");
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error("The purchase transaction reverted.");
        const [ev] = parseEventLogs({ abi: backstopAbi, logs: receipt.logs, eventName: "PolicyPurchased" });
        setResult({
          policyId: Number(ev?.args.policyId ?? 0),
          txHash: hash,
          premiumUsdc: q.breakdown.premiumUsdc,
          payoutUsdc: q.breakdown.payoutUsdc,
        });
        setStep("done");
        qc.invalidateQueries({ queryKey: ["policies"] });
        qc.invalidateQueries({ queryKey: ["stats"] });
        qc.invalidateQueries({ queryKey: ["readContract"] });
      } catch (e) {
        setError(errorMessage(e));
        setStep("error");
      }
    },
    [address, chainId, switchChain, write, qc],
  );

  return { step, error, result, quoteExpiry, buy, reset };
}

export type Tick = {
  lastNo?: number;
  /** YES ask after each refresh since the page opened (max 60 points = 5 minutes) */
  series: number[];
  yesDir: -1 | 0 | 1;
  noDir: -1 | 0 | 1;
  /** bumps whenever a price changes, used to restart the flash animation */
  yesSeq: number;
  noSeq: number;
};

/** Records each market's prices on every refresh, so rows can show movement. */
export function usePriceTicks(markets: Market[] | undefined) {
  const [ticks, setTicks] = useState<Map<string, Tick>>(() => new Map());
  useEffect(() => {
    if (!markets) return;
    setTicks((prev) => {
      const next = new Map<string, Tick>();
      for (const m of markets) {
        const t = prev.get(m.instrumentSymbol);
        if (!t) {
          next.set(m.instrumentSymbol, { series: [m.askYes], yesDir: 0, noDir: 0, yesSeq: 0, noSeq: 0 });
          continue;
        }
        const lastYes = t.series[t.series.length - 1]!;
        const prevNo = t.lastNo ?? m.askNo;
        const yesDir = Math.sign(m.askYes - lastYes) as Tick["yesDir"];
        const noDir = Math.sign(m.askNo - prevNo) as Tick["noDir"];
        next.set(m.instrumentSymbol, {
          series: [...t.series, m.askYes].slice(-60),
          yesDir: yesDir || t.yesDir,
          noDir: noDir || t.noDir,
          yesSeq: t.yesSeq + (yesDir ? 1 : 0),
          noSeq: t.noSeq + (noDir ? 1 : 0),
          lastNo: m.askNo,
        });
      }
      return next;
    });
  }, [markets]);
  return ticks;
}
