"use client";

import { useBackendConfig } from "@/lib/hooks";
import { ConnectButton } from "./ConnectButton";
import { ArcLogo, GeminiLogo } from "./logos";
import { Wordmark } from "./ui";

const LINKS = [
  { href: "#cover", label: "Buy cover" },
  { href: "#agent", label: "Grok agent" },
  { href: "#policies", label: "My cover" },
  { href: "#how", label: "How it works" },
];

export function Nav() {
  const { data: conf } = useBackendConfig();
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/95 backdrop-blur-[2px]">
      <nav className="mx-auto flex h-16 max-w-[1240px] items-center justify-between gap-6 px-5 sm:px-8">
        <div className="flex items-center gap-10">
          <a href="#top" aria-label="Backstop, top of page">
            <Wordmark />
          </a>
          <div className="hidden items-center gap-6 md:flex">
            {LINKS.map((l) => (
              <a key={l.href} href={l.href} className="text-sm text-fg-2 hover:text-fg">
                {l.label}
              </a>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-5">
          <p className="hidden items-center gap-2 text-xs text-fg-2 lg:flex">
            <span>Settled on</span>
            <ArcLogo className="h-3.5 w-auto text-fg" />
            <span className="mx-1 h-3 w-px bg-line-strong" />
            <span>Hedged on</span>
            <GeminiLogo className="h-3 w-auto text-fg" />
            {conf && conf.hedgeMode !== "live" && <span className="text-fg-3">({conf.hedgeMode})</span>}
          </p>
          <ConnectButton />
        </div>
      </nav>
    </header>
  );
}
