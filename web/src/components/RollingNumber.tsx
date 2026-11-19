"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { cx } from "./ui";

/**
 * A number whose digits roll like an odometer when the value changes.
 * Non-digit characters (".", ",", "$") stay put; each digit is a vertical strip 0–9.
 * The strip moves in whole pixels (measured from the font size), so every digit lands on
 * the same baseline instead of drifting by sub-pixel rounding.
 */
export function RollingNumber({ value, className }: { value: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [step, setStep] = useState<number>();

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setStep(Math.round(parseFloat(getComputedStyle(el).fontSize) * 1.2));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const h = step ? `${step}px` : "1.2em";
  return (
    <span ref={ref} className={cx("num inline-flex items-center overflow-hidden", className)} style={{ lineHeight: h }} aria-label={value}>
      {value.split("").map((ch, i) =>
        /\d/.test(ch) ? (
          <span key={`${value.length}-${i}`} className="relative inline-block w-[0.62em] overflow-hidden" style={{ height: h }} aria-hidden>
            <span
              className="absolute left-0 top-0 flex w-full flex-col transition-transform duration-500 ease-[cubic-bezier(0.2,0.7,0.2,1)]"
              style={{ transform: step ? `translateY(-${Number(ch) * step}px)` : `translateY(-${Number(ch) * 10}%)` }}
            >
              {"0123456789".split("").map((d) => (
                <span key={d} className="block text-center" style={{ height: h, lineHeight: h }}>
                  {d}
                </span>
              ))}
            </span>
          </span>
        ) : (
          <span key={`${value.length}-${i}`} className="inline-block" style={{ height: h, lineHeight: h }} aria-hidden>
            {ch}
          </span>
        ),
      )}
    </span>
  );
}
