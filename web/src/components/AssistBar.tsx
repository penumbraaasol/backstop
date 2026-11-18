"use client";

import { useMutation } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { api, type Suggestion } from "@/lib/api";
import { errorMessage, useBackendConfig } from "@/lib/hooks";
import { Button, cx } from "./ui";

const EXAMPLES = [
  "I hold BTC and I'm worried it drops in the next hour",
  "I'm buying ETH tonight, protect me if it pumps first",
  "Cover me against SOL falling before the next close",
];

/** Plain-English request → Grok suggests one policy → the ticket below is filled in. The buyer still signs. */
export function AssistBar({ onSuggestion }: { onSuggestion: (s: Suggestion) => void }) {
  const { data: conf } = useBackendConfig();
  const [text, setText] = useState("");
  const ask = useMutation({
    mutationFn: (message: string) => api.assist(message),
    onSuccess: (s) => s.instrumentSymbol && onSuggestion(s),
  });

  if (conf && !conf.assistant) return null;

  const submit = (message: string) => {
    const m = message.trim();
    if (m.length < 3 || ask.isPending) return;
    setText(m);
    ask.mutate(m);
  };
  const s = ask.data;

  return (
    <div className="rounded-lg border border-line bg-surface p-4 sm:p-5">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(text);
        }}
        className="flex flex-col gap-3 sm:flex-row sm:items-center"
      >
        <label htmlFor="assist" className="shrink-0 text-sm font-semibold tracking-tight sm:w-28">
          Ask Grok
          <span className="block text-xs font-normal text-fg-2">describe your risk</span>
        </label>
        <input
          id="assist"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={500}
          placeholder="e.g. I hold 0.2 BTC and I'm worried it drops before midnight"
          className="min-w-0 flex-1 rounded-md border border-line-strong bg-surface-2 px-3.5 py-2.5 text-sm text-fg placeholder:text-fg-3 focus:border-fg-3 focus:outline-none"
        />
        <Button type="submit" loading={ask.isPending} disabled={text.trim().length < 3}>
          Suggest cover <ArrowRight className="size-4" />
        </Button>
      </form>

      {!s && !ask.isPending && !ask.isError && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs sm:pl-[7.75rem]">
          {EXAMPLES.map((e) => (
            <button key={e} onClick={() => submit(e)} className="text-fg-2 underline-offset-4 hover:text-fg hover:underline">
              {e}
            </button>
          ))}
        </div>
      )}

      {ask.isError && (
        <p role="alert" className="mt-3 text-sm text-down sm:pl-[7.75rem]">
          {errorMessage(ask.error)}
        </p>
      )}

      {s && !ask.isPending && <Answer s={s} />}
    </div>
  );
}

function Answer({ s }: { s: Suggestion }) {
  const found = !!s.instrumentSymbol;
  return (
    <div className="settle mt-4 border-t border-line pt-4 sm:pl-[7.75rem]">
      <p className={cx("text-md font-medium", !found && "text-fg-2")}>{s.summary}</p>
      <p className="mt-1 max-w-3xl text-sm text-fg-2">{s.reasoning}</p>
      <p className="mt-2 font-mono text-xs text-fg-3">
        {found ? "Filled in below. Review it, then buy from your wallet." : "Nothing was filled in."} · {s.model}
      </p>
    </div>
  );
}
