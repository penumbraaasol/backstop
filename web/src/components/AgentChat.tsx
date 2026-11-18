"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Check, ChevronDown, X } from "lucide-react";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { api, type ChatMessage, type ChatStep } from "@/lib/api";
import { errorMessage } from "@/lib/hooks";
import { GrokMark } from "./logos";
import { cx, ExtLink } from "./ui";

const STARTERS = [
  "I hold 0.3 BTC. Protect me from a dip in the next 15 minutes.",
  "Keep me covered against ETH dropping on every 15-minute window while cover is under 0.55.",
  "What are you watching right now, and what have you bought?",
  "Which market has the cheapest downside cover right now?",
];

const STORE = "backstop.agent.chat.v1";
const load = (): ChatMessage[] => {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? "[]");
  } catch {
    return [];
  }
};

/** A chat with the Grok Bot. Tool calls show as steps; purchases link to Arc. */
export function AgentChat({ seed }: { seed?: ChatMessage[] } = {}) {
  const qc = useQueryClient();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => setMessages(seed ?? load()), [seed]);
  useEffect(() => {
    if (seed) return; // a seeded conversation is never saved
    try {
      localStorage.setItem(STORE, JSON.stringify(messages.slice(-30)));
    } catch {
      /* storage unavailable */
    }
    // scroll only the chat box, and only when there is a conversation (never the page)
    const el = scroller.current;
    if (el && messages.length) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = useMutation({
    mutationFn: (history: ChatMessage[]) => api.chat(history),
    onSuccess: (r) => {
      setMessages((m) => [...m, { role: "assistant", content: r.reply, steps: r.steps }]);
      if (r.steps.length) {
        qc.invalidateQueries({ queryKey: ["agent"] });
        qc.invalidateQueries({ queryKey: ["agentActivity"] });
        qc.invalidateQueries({ queryKey: ["policies"] });
      }
    },
  });

  const submit = (value = text) => {
    const content = value.trim();
    if (!content || send.isPending) return;
    const next = [...messages, { role: "user" as const, content }];
    setMessages(next);
    setText("");
    send.mutate(next);
    requestAnimationFrame(() => input.current?.focus());
  };

  // auto-grow the composer like the Grok app
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  const empty = messages.length === 0;

  return (
    <div className="light-scope flex h-[640px] flex-col overflow-hidden rounded-[22px] border border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <p className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <GrokMark className="size-5 text-fg" />
          Grok Bot
        </p>
        {!empty && (
          <button
            onClick={() => {
              setMessages([]);
              send.reset();
            }}
            className="text-xs text-fg-2 hover:text-fg"
          >
            New chat
          </button>
        )}
      </div>

      <div ref={scroller} className="flex-1 overflow-y-auto px-5 py-6">
        {empty ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <p className="text-xl font-semibold tracking-[-0.03em]">What should I protect?</p>
            <p className="mt-2 max-w-sm text-sm text-fg-2">
              Tell me what you hold or what you&apos;re worried about, and I&apos;ll cover it.
            </p>
            <div className="mt-8 grid w-full max-w-xl gap-2 sm:grid-cols-2">
              {STARTERS.map((s) => (
                <button
                  key={s}
                  onClick={() => submit(s)}
                  className="rounded-2xl border border-line px-4 py-3 text-left text-sm text-fg-2 transition-colors hover:border-line-strong hover:bg-surface-2 hover:text-fg"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-2xl space-y-6">
            {messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <p className="max-w-[85%] whitespace-pre-wrap rounded-3xl bg-surface-2 px-4 py-2.5 text-sm leading-relaxed">{m.content}</p>
                </div>
              ) : (
                <div key={i} className="settle">
                  {m.steps && m.steps.length > 0 && <Steps steps={m.steps} />}
                  <div className="text-sm leading-relaxed text-fg">
                    <Markdownish text={m.content} />
                  </div>
                </div>
              ),
            )}
            {send.isPending && <Thinking />}
            {send.isError && (
              <p role="alert" className="text-sm text-down">
                {errorMessage(send.error)}
              </p>
            )}
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="p-3 pt-0"
      >
        <div className="flex items-end gap-2 rounded-[26px] border border-line-strong bg-surface-2 py-2 pl-5 pr-2 focus-within:border-fg-3">
          <textarea
            ref={input}
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            maxLength={2000}
            placeholder="Ask Grok to protect a position…"
            className="max-h-40 min-h-[24px] flex-1 resize-none bg-transparent py-1.5 text-sm text-fg placeholder:text-fg-3 focus:outline-none focus-visible:outline-none"
          />
          <button
            type="submit"
            aria-label="Send"
            disabled={!text.trim() || send.isPending}
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-fg text-bg transition-opacity disabled:opacity-25"
          >
            <ArrowUp className="size-4" strokeWidth={2.5} />
          </button>
        </div>
        <p className="mt-2 text-center text-[11px] text-fg-3">
          Purchases are capped and logged on the right.
        </p>
      </form>
    </div>
  );
}

function Thinking() {
  return (
    <p className="flex items-center gap-2 text-sm text-fg-2" aria-live="polite">
      <span className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <span key={i} className="size-1.5 animate-pulse rounded-full bg-fg-2" style={{ animationDelay: `${i * 150}ms` }} />
        ))}
      </span>
      Screening markets and checking the chain…
    </p>
  );
}

/** Tool calls, collapsed to one line like the Grok app, expandable. */
function Steps({ steps }: { steps: ChatStep[] }) {
  const [open, setOpen] = useState(steps.some((s) => s.tool === "buy_cover" || !s.ok));
  const failed = steps.filter((s) => !s.ok).length;
  return (
    <div className="mb-3">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 text-xs text-fg-2 hover:text-fg">
        <ChevronDown className={cx("size-3.5 transition-transform", !open && "-rotate-90")} />
        Used {steps.length} tool{steps.length > 1 ? "s" : ""}
        {failed > 0 && <span className="text-warn">({failed} failed)</span>}
      </button>
      {open && (
        <ol className="mt-2 space-y-1.5 border-l border-line pl-4">
          {steps.map((s, i) => (
            <li key={i} className="text-xs">
              <span className="flex items-start gap-2">
                <span className={cx("mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-full", s.ok ? "bg-up/15 text-up" : "bg-down/15 text-down")}>
                  {s.ok ? <Check className="size-2.5" strokeWidth={3} /> : <X className="size-2.5" strokeWidth={3} />}
                </span>
                <span>
                  <span className={cx("whitespace-pre-line", s.tool === "buy_cover" && s.ok ? "font-medium text-up" : "text-fg")}>{s.label.replace(/\s+·\s+/g, "\n")}</span>
                  {s.detail && <span className="block whitespace-pre-line text-fg-2">{s.detail.replace(/\s+·\s+/g, "\n")}</span>}
                  {s.url && (
                    <ExtLink href={s.url} className="ml-1.5 font-mono text-fg-2">
                      tx ↗
                    </ExtLink>
                  )}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Just enough formatting for chat replies: paragraphs, "- " bullets, **bold**, `code`. */
export function Markdownish({ text }: { text: string }) {
  const inline = (s: string): ReactNode[] =>
    s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
      part.startsWith("**") ? (
        <b key={i} className="font-semibold">
          {part.slice(2, -2)}
        </b>
      ) : part.startsWith("`") ? (
        <code key={i} className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[12px]">
          {part.slice(1, -1)}
        </code>
      ) : (
        <Fragment key={i}>{part}</Fragment>
      ),
    );
  const FACT = /^\s*\*{0,2}([A-Z][A-Za-z ]{1,18}):\*{0,2}\s+(.+)$/;
  const BULLET = /^\s*([-*•]|\d+\.)\s+/;
  const clean = (t: string) => t.replace(/[ \t]+$/gm, "").replace(/\s+—\s+/g, ": ").trim();
  // group lines into parts: headline, facts ("Label: value"), a label with bullets, or plain text
  type Part = { kind: "head" | "facts" | "list" | "text"; label?: string; lines: string[] };
  const parts: Part[] = [];
  const all = clean(text).split("\n");
  for (let n = 0; n < all.length; n++) {
    const l = all[n].trim();
    const last = parts[parts.length - 1];
    if (!l) {
      parts.push({ kind: "text", lines: [] }); // paragraph break
      continue;
    }
    if (/^\*\*[^*]+\*\*$/.test(l)) parts.push({ kind: "head", lines: [l.slice(2, -2)] });
    else if (BULLET.test(l)) {
      if (last?.kind === "list") last.lines.push(l.replace(BULLET, ""));
      else parts.push({ kind: "list", lines: [l.replace(BULLET, "")] });
    } else if (/^\*{0,2}[A-Z][A-Za-z ]{1,18}:\*{0,2}$/.test(l) && BULLET.test(all[n + 1]?.trim() ?? ""))
      parts.push({ kind: "list", label: l.replace(/\*\*/g, "").replace(/:$/, ""), lines: [] });
    else if (FACT.test(l)) {
      if (last?.kind === "facts") last.lines.push(l);
      else parts.push({ kind: "facts", lines: [l] });
    } else if (last?.kind === "text" && last.lines.length) last.lines.push(l);
    else parts.push({ kind: "text", lines: [l] });
  }
  return (
    <div className="space-y-3">
      {parts
        .filter((p) => p.lines.length)
        .map((p, i) =>
          p.kind === "head" ? (
            <p key={i} className="text-[15px] font-semibold tracking-tight text-fg">
              {inline(p.lines[0])}
            </p>
          ) : p.kind === "facts" ? (
            <dl key={i} className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-1.5 rounded-2xl border border-line px-4 py-3 text-[13px]">
              {p.lines.map((l, j) => {
                const [, k, v] = l.match(FACT)!;
                return (
                  <Fragment key={j}>
                    <dt className="text-fg-3">{k}</dt>
                    <dd className="num text-fg">{inline(v)}</dd>
                  </Fragment>
                );
              })}
            </dl>
          ) : p.kind === "list" ? (
            <div key={i}>
              {p.label && <p className="mb-1 text-[13px] font-medium text-fg-2">{p.label}</p>}
              <ul className="space-y-1 pl-4 text-[13px]">
                {p.lines.map((l, j) => (
                  <li key={j} className="list-disc marker:text-fg-3">
                    {inline(l)}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p key={i} className="text-fg-2">
              {p.lines.map((l, j) => (
                <Fragment key={j}>
                  {j > 0 && <br />}
                  {inline(l)}
                </Fragment>
              ))}
            </p>
          ),
        )}
    </div>
  );
}
