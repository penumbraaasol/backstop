"use client";

import { ChevronDown } from "lucide-react";
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

export function ConnectButton({ className, block, compact }: { className?: string; block?: boolean; compact?: boolean }) {
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

  const w = block ? "w-full py-3" : compact ? "h-9 px-3.5 py-0 text-[13px]" : "";

  if (!mounted) return <div className={cx("placeholder h-10 w-36", block && "w-full", className)} />;

  if (!isConnected) {
    // wallets announce themselves (EIP-6963): use MetaMask when it's installed, otherwise whatever wallet is there
    const injected =
      connectors.find((c) => c.id === "io.metamask" || /metamask/i.test(c.name)) ??
      connectors.find((c) => c.id !== "injected") ??
      connectors[0];
    const hasWallet = typeof window !== "undefined" && "ethereum" in window;
    if (!hasWallet)
      return (
        <a href="https://metamask.io/download" target="_blank" rel="noreferrer" className={cx(block && "block", className)}>
          <Button variant="secondary" className={w}>
            {block ? "Install MetaMask to continue" : "Install MetaMask"}
          </Button>
        </a>
      );
    return (
      <Button
        variant={block ? "primary" : "secondary"}
        className={cx(w, className)}
        loading={isPending}
        onClick={() => injected && connect({ connector: injected, chainId: arcTestnet.id })}
      >
        Connect wallet
      </Button>
    );
  }

  if (chainId !== arcTestnet.id)
    return (
      <Button
        variant="secondary"
        className={cx("border-warn text-warn", w, className)}
        loading={switching}
        onClick={() => switchChain({ chainId: arcTestnet.id })}
      >
        Switch to Arc Testnet
      </Button>
    );

  if (block) return null;

  const usdc = bal !== undefined ? (Number(bal) / 1e6).toFixed(2) : "–";

  return (
    <div ref={ref} className={cx("relative", className)}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={cx("flex items-center gap-3 rounded-md border border-line bg-surface pl-3 pr-2 text-sm transition-colors hover:border-line-strong", compact ? "h-9" : "py-2")}
      >
        <span className="num font-medium">{usdc} USDC</span>
        <span className="h-4 w-px bg-line" />
        <span className="font-mono text-xs text-fg-2">{shortAddr(address)}</span>
        <ChevronDown className={cx("size-4 text-fg-2 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-60 rounded-md border border-line-strong bg-surface py-1 text-sm shadow-[4px_4px_0_0_var(--color-line)]">
          <p className="border-b border-line px-3 py-2 text-xs text-fg-2">
            Arc Testnet
            <br />
            {shortAddr(address)}
          </p>
          <MenuItem onClick={() => navigator.clipboard.writeText(address!)}>Copy address</MenuItem>
          <MenuItem href={addressUrl(address!)}>View on Arc explorer</MenuItem>
          <MenuItem href={FAUCET_URL}>Get testnet USDC</MenuItem>
          <MenuItem onClick={() => disconnect()}>Disconnect</MenuItem>
        </div>
      )}
    </div>
  );
}

function MenuItem({ children, href, onClick }: { children: React.ReactNode; href?: string; onClick?: () => void }) {
  const cls = "block w-full px-3 py-2 text-left hover:bg-surface-2";
  return href ? (
    <a className={cls} href={href} target="_blank" rel="noreferrer">
      {children} ↗
    </a>
  ) : (
    <button className={cls} onClick={onClick}>
      {children}
    </button>
  );
}
