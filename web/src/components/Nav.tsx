"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "./ConnectButton";
import { ArcLogo, GeminiLogo, GrokLogo } from "./logos";
import { cx, Mark, Wordmark } from "./ui";

const LINKS = [
  { href: "/", label: "Buy cover" },
  { href: "/agent", label: "Grok agent" },
  { href: "/cover", label: "My cover" },
  { href: "/how", label: "How it works" },
];

const isActive = (href: string, path: string) => (href === "/" ? path === "/" : path.startsWith(href));

export function Nav() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/95 backdrop-blur-[2px]">
      <nav className="mx-auto flex h-16 max-w-[1240px] items-center justify-between gap-4 px-5 sm:gap-6 sm:px-8">
        <div className="flex h-full min-w-0 items-center gap-5 md:gap-10">
          <Link href="/" aria-label="Backstop home" className="shrink-0">
            <span className="md:hidden">
              <Mark className="size-[22px]" />
            </span>
            <span className="hidden md:inline">
              <Wordmark />
            </span>
          </Link>
          {/* one row at every width: on narrow screens the links scroll sideways instead of wrapping */}
          <div className="flex h-full min-w-0 items-center gap-4 overflow-x-auto [scrollbar-width:none] md:gap-6 [&::-webkit-scrollbar]:hidden">
            {LINKS.map((l) => {
              const active = isActive(l.href, path);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "-mb-px flex h-full shrink-0 items-center whitespace-nowrap border-b-2 text-sm transition-colors",
                    active ? "border-fg text-fg" : "border-transparent text-fg-2 hover:text-fg",
                  )}
                >
                  {l.label}
                </Link>
              );
            })}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-6">
          {/* the three platforms: logos from 1024px, with their roles once there's room */}
          <ul className="hidden items-center text-xs text-fg-2 lg:flex" aria-label="Built on">
            {[
              { role: "Settled on", logo: <ArcLogo className="h-[15px] w-auto" /> },
              { role: "Hedged on", logo: <GeminiLogo className="h-[12px] w-auto" /> },
              { role: "Performed by", logo: <GrokLogo className="h-[17px] w-auto" /> },
            ].map((p, i) => (
              <li key={p.role} className={cx("flex h-5 items-center gap-2 text-fg", i > 0 && "ml-4 border-l border-line-strong pl-4")}>
                <span className="hidden text-fg-2 xl:inline">{p.role}</span>
                {p.logo}
              </li>
            ))}
          </ul>
          <ConnectButton compact />
        </div>
      </nav>
    </header>
  );
}
