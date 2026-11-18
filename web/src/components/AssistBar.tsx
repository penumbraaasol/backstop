"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, type AgentRun, type Suggestion } from "@/lib/api";
import { txUrl } from "@/lib/chain";
import { errorMessage, useBackendConfig } from "@/lib/hooks";
import { Button, cx, ExtLink, Spinner } from "./ui";

const EXAMPLES = [
  "I hold BTC and I'm worried it drops in the next hour",
  "I'm buying ETH tonight, protect me if it pumps first",
  "Cover me against SOL falling before the next close",
];

type Result = { kind: "suggest"; s: Suggestion } | { kind: "agent"; r: AgentRun };

/**
 * Plain-English risk → Grok.
 *  - "Suggest cover" fills in the ticket; the buyer signs.
 *  - "Let Grok buy it" has the Grok agent buy the policy from its own testnet wallet.
 */
export function AssistBar({ onSuggestion }: { onSuggestion: (s: Suggestion) => void }) {
  const qc = useQueryClient();
  const { data: conf } = useBackendConfig();
  const [text, setText] = useState("");
  const [result, setResult] = useState<Result>();

  const suggest = useMutation({
    mutationFn: (m: string) => api.assist(m),
    onSuccess: (s) => {
      setResult({ kind: "suggest", s });
      if (s.instrumentSymbol) onSuggestion(s);
    },
  });
  const agent = useMutation({
    mutationFn: (m: string) => api.runAgent(m),
    onSuccess: (r) => {
      setResult({ kind: "agent", r });
      qc.invalidateQueries({ queryKey: ["agent"] });
      qc.invalidateQueries({ queryKey: ["policies"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });

  if (conf && !conf.assistant) return null;
  const busy = suggest.isPending || agent.isPending;
  const error = suggest.error ?? agent.error;
  const go = (which: "suggest" | "agent", message = text) => {
    const m = message.trim();
    if (m.length < 3 || busy) return;
    setText(m);
    setResult(undefined);
    suggest.reset();
    agent.reset();
    (which === "suggest" ? suggest : agent).mutate(m);
  };

  return (
    <div className="rounded-lg border border-line bg-surface p-4 sm:p-5">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          go("suggest");
        }}
        className="flex flex-col gap-3 lg:flex-row lg:items-center"
      >
        <label htmlFor="assist" className="shrink-0 text-sm font-semibold tracking-tight lg:w-28">
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
        <div className="flex gap-2">
          <Button type="submit" variant="secondary" loading={suggest.isPending} disabled={busy || text.trim().length < 3}>
            Suggest cover
          </Button>
          {conf?.agent && (
            <Button type="button" loading={agent.isPending} disabled={busy || text.trim().length < 3} onClick={() => go("agent")}>
              Let Grok buy it
            </Button>
          )}
        </div>
      </form>

      {!result && !busy && !error && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs lg:pl-[7.75rem]">
          {EXAMPLES.map((e) => (
            <button key={e} onClick={() => setText(e)} className="text-fg-2 underline-offset-4 hover:text-fg hover:underline">
              {e}
            </button>
          ))}
        </div>
      )}

      {agent.isPending && (
        <p className="mt-4 flex items-center gap-2 border-t border-line pt-4 text-sm text-fg-2 lg:pl-[7.75rem]">
          <Spinner /> Grok is choosing a market, then the agent wallet signs the purchase on Arc…
        </p>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-down lg:pl-[7.75rem]">
          {errorMessage(error)}
        </p>
      )}

      {result && !busy && (
        <div className="settle mt-4 border-t border-line pt-4 lg:pl-[7.75rem]">
          {result.kind === "suggest" ? <SuggestAnswer s={result.s} /> : <AgentAnswer r={result.r} />}
        </div>
      )}
    </div>
  );
}

function SuggestAnswer({ s }: { s: Suggestion }) {
  const found = !!s.instrumentSymbol;
  return (
    <>
      <p className={cx("text-md font-medium", !found && "text-fg-2")}>{s.summary}</p>
      <p className="mt-1 max-w-3xl text-sm text-fg-2">{s.reasoning}</p>
      <p className="mt-2 font-mono text-xs text-fg-3">
        {found ? "Filled in below. Review it, then buy from your wallet." : "Nothing was filled in."} · {s.model}
      </p>
    </>
  );
}

function AgentAnswer({ r }: { r: AgentRun }) {
  if (r.status === "bought")
    return (
      <>
        <p className="flex flex-wrap items-baseline gap-x-2 text-md font-medium">
          <span className="text-up">Grok bought policy No. {r.policyId}</span>
          <span className="num text-fg-2">
            · paid {r.premiumUsdc} USDC for {r.payout}.00 USDC of cover
          </span>
        </p>
        <p className="mt-1 text-sm">{r.summary}</p>
        <p className="mt-1 max-w-3xl text-sm text-fg-2">{r.reasoning}</p>
        <p className="mt-2 flex flex-wrap gap-x-4 text-xs">
          {r.tx && (
            <ExtLink href={r.url ?? txUrl(r.tx)} className="font-mono text-fg-2">
              purchase tx {r.tx.slice(0, 10)}… ↗
            </ExtLink>
          )}
          <a href="#agent" className="text-fg-2 underline underline-offset-4 hover:text-fg">
            Follow it in the agent log ↓
          </a>
        </p>
      </>
    );
  return (
    <>
      <p className={cx("text-md font-medium", r.status === "declined" ? "text-fg-2" : "text-warn")}>
        {r.status === "declined" ? "Grok decided not to buy." : r.status === "blocked" ? "The agent's limits stopped this purchase." : "The purchase failed."}
      </p>
      <p className="mt-1 text-sm">{r.summary}</p>
      <p className="mt-1 max-w-3xl text-sm text-fg-2">{r.error ?? r.reasoning}</p>
    </>
  );
}
