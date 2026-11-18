"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "./ConnectButton";
import { ArcLogo, GeminiLogo, GrokLogo } from "./logos";
import { cx, Wordmark } from "./ui";

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
      <nav className="mx-auto flex h-16 max-w-[1240px] items-center justify-between gap-6 px-5 sm:px-8">
        <div className="flex h-full items-center gap-10">
          <Link href="/" aria-label="Backstop home">
            <Wordmark />
          </Link>
          <div className="hidden h-full items-center gap-6 md:flex">
            {LINKS.map((l) => {
              const active = isActive(l.href, path);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "-mb-px flex h-full items-center border-b-2 text-sm transition-colors",
                    active ? "border-fg text-fg" : "border-transparent text-fg-2 hover:text-fg",
                  )}
                >
                  {l.label}
                </Link>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-6">
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
      {/* phone: the same pages as a scrollable row */}
      <div className="flex gap-5 overflow-x-auto border-t border-line px-5 md:hidden">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={cx(
              "shrink-0 border-b-2 py-2.5 text-sm",
              isActive(l.href, path) ? "border-fg text-fg" : "border-transparent text-fg-2",
            )}
          >
            {l.label}
          </Link>
        ))}
      </div>
    </header>
  );
}
