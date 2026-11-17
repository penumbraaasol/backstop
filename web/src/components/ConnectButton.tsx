"use client";

import { ChevronDown, Copy, Droplets, ExternalLink, LogOut, Wallet } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useChainId, useConnect, useConnection, useConnectors, useDisconnect, useSwitchChain } from "wagmi";
import { addressUrl, arcTestnet, FAUCET_URL } from "@/lib/chain";
import { shortAddr } from "@/lib/format";
import { useUsdcBalance } from "@/lib/hooks";
import { Button, cx } from "./ui";

export function useMounted() {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

export function ConnectButton({ className, size = "md" }: { className?: string; size?: "md" | "lg" }) {
  const mounted = useMounted();
  const { address, isConnected } = useConnection();
  const chainId = useChainId();
  const connectors = useConnectors();
  const { mutate: connect, isPending } = useConnect();
  const { mutate: switchChain, isPending: switching } = useSwitchChain();
  const { mutate: disconnect } = useDisconnect();
  const { data: bal } = useUsdcBalance();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const big = size === "lg" ? "px-5 py-3 text-[15px]" : "";

  if (!mounted) return <div className={cx("h-10 w-36 rounded-xl skeleton", className)} />;

  if (!isConnected) {
    const injected = connectors[0];
    const hasWallet = typeof window !== "undefined" && "ethereum" in window;
    if (!hasWallet)
      return (
        <a href="https://rabby.io" target="_blank" rel="noreferrer" className={className}>
          <Button variant="secondary" className={big}>
            <Wallet className="size-4" /> Install a wallet
          </Button>
        </a>
      );
    return (
      <Button
        className={cx(big, className)}
        loading={isPending}
        onClick={() => injected && connect({ connector: injected, chainId: arcTestnet.id })}
      >
        <Wallet className="size-4" /> Connect wallet
      </Button>
    );
  }

  if (chainId !== arcTestnet.id)
    return (
      <Button
        variant="secondary"
        className={cx("border-warn/40 text-warn", big, className)}
        loading={switching}
        onClick={() => switchChain({ chainId: arcTestnet.id })}
      >
        Switch to Arc Testnet
      </Button>
    );

  const usdc = bal !== undefined ? (Number(bal) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 }) : "–";

  return (
    <div ref={ref} className={cx("relative", className)}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-xl border border-line-strong bg-white/[0.04] py-1.5 pl-3 pr-2 text-sm transition hover:bg-white/[0.08]"
      >
        <span className="font-medium tabular-nums">{usdc} USDC</span>
        <span className="h-4 w-px bg-line-strong" />
        <span className="flex items-center gap-1.5 rounded-lg bg-white/[0.06] px-2 py-1 font-mono text-xs text-muted">
          <span className="size-2 rounded-full bg-linear-to-br from-mint to-violet" />
          {shortAddr(address)}
        </span>
        <ChevronDown className={cx("size-4 text-muted transition", open && "rotate-180")} />
      </button>
      {open && (
        <div className="card absolute right-0 z-50 mt-2 w-64 animate-fade-up p-1.5 text-sm">
          <div className="px-3 py-2.5">
            <p className="text-xs text-muted">Connected to Arc Testnet</p>
            <p className="mt-0.5 font-mono text-xs">{shortAddr(address)}</p>
          </div>
          <MenuItem onClick={() => navigator.clipboard.writeText(address!)} icon={<Copy className="size-4" />}>
            Copy address
          </MenuItem>
          <MenuItem href={addressUrl(address!)} icon={<ExternalLink className="size-4" />}>
            View on explorer
          </MenuItem>
          <MenuItem href={FAUCET_URL} icon={<Droplets className="size-4" />}>
            Get testnet USDC
          </MenuItem>
          <div className="my-1 h-px bg-line" />
          <MenuItem onClick={() => disconnect()} icon={<LogOut className="size-4" />}>
            Disconnect
          </MenuItem>
        </div>
      )}
    </div>
  );
}

function MenuItem({
  children,
  icon,
  href,
  onClick,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  href?: string;
  onClick?: () => void;
}) {
  const cls = "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-fg/90 transition hover:bg-white/[0.06]";
  return href ? (
    <a className={cls} href={href} target="_blank" rel="noreferrer">
      <span className="text-muted">{icon}</span>
      {children}
    </a>
  ) : (
    <button className={cls} onClick={onClick}>
      <span className="text-muted">{icon}</span>
      {children}
    </button>
  );
}
