"use client";

import { useEffect, useState } from "react";
import { useBackendConfig } from "@/lib/hooks";
import { ConnectButton } from "./ConnectButton";
import { Badge, cx, Logo } from "./ui";

const LINKS = [
  { href: "#cover", label: "Get cover" },
  { href: "#policies", label: "My cover" },
  { href: "#how", label: "How it works" },
];

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const { data: conf } = useBackendConfig();
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  return (
    <header
      className={cx(
        "sticky top-0 z-40 transition-all duration-300",
        scrolled ? "border-b border-line bg-ink/75 backdrop-blur-xl" : "border-b border-transparent",
      )}
    >
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-5 sm:px-8">
        <div className="flex items-center gap-8">
          <a href="#top" aria-label="Backstop home">
            <Logo />
          </a>
          <div className="hidden items-center gap-1 md:flex">
            {LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="rounded-lg px-3 py-1.5 text-sm text-muted transition hover:bg-white/5 hover:text-fg"
              >
                {l.label}
              </a>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Badge tone="violet" className="hidden lg:inline-flex" dot>
            Arc Testnet
          </Badge>
          {conf && (
            <Badge tone={conf.hedgeMode === "live" ? "mint" : "warn"} className="hidden md:inline-flex">
              Hedge: Gemini {conf.hedgeMode}
            </Badge>
          )}
          <ConnectButton />
        </div>
      </nav>
    </header>
  );
}
