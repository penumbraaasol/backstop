"use client";

import { cx } from "./ui";

/**
 * A number whose digits roll like an odometer when the value changes.
 * Non-digit characters (".", ",", "$") stay put; each digit is a vertical strip 0–9.
 */
export function RollingNumber({ value, className }: { value: string; className?: string }) {
  return (
    <span className={cx("num inline-flex items-center overflow-hidden leading-[1.2]", className)} aria-label={value}>
      {value.split("").map((ch, i) =>
        /\d/.test(ch) ? (
          <span key={`${value.length}-${i}`} className="relative inline-block h-[1.2em] w-[0.62em] overflow-hidden" aria-hidden>
            <span
              className="absolute left-0 top-0 flex flex-col transition-transform duration-500 ease-[cubic-bezier(0.2,0.7,0.2,1)]"
              style={{ transform: `translateY(-${Number(ch) * 10}%)` }}
            >
              {"0123456789".split("").map((d) => (
                <span key={d} className="block h-[1.2em] text-center leading-[1.2]">
                  {d}
                </span>
              ))}
            </span>
          </span>
        ) : (
          <span key={`${value.length}-${i}`} className="inline-block h-[1.2em] leading-[1.2]" aria-hidden>
            {ch}
          </span>
        ),
      )}
    </span>
  );
}
