import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { cfg } from "./config.js";

mkdirSync(dirname(cfg.DB_PATH), { recursive: true });
export const db = new DatabaseSync(cfg.DB_PATH);

db.exec(`
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS quotes (
  nonce            TEXT PRIMARY KEY,
  buyer            TEXT NOT NULL,
  instrument_symbol TEXT NOT NULL,
  event_ticker     TEXT NOT NULL,
  market_title     TEXT,
  market_id        TEXT NOT NULL,
  outcome          INTEGER NOT NULL,
  payout           TEXT NOT NULL,   -- USDC base units
  premium          TEXT NOT NULL,   -- USDC base units
  price            TEXT NOT NULL,   -- Gemini ask p used for the quote (0..1)
  spread           TEXT NOT NULL,
  quote_expiry     INTEGER NOT NULL,
  resolve_by       INTEGER NOT NULL,
  market_expiry    TEXT NOT NULL,
  created_at       INTEGER NOT NULL,
  policy_id        INTEGER
);
CREATE INDEX IF NOT EXISTS quotes_match ON quotes(buyer, market_id, outcome, payout, premium);

CREATE TABLE IF NOT EXISTS policies (
  policy_id        INTEGER PRIMARY KEY,
  buyer            TEXT NOT NULL,
  instrument_symbol TEXT NOT NULL,
  event_ticker     TEXT NOT NULL,
  market_title     TEXT,
  market_id        TEXT NOT NULL,
  outcome          INTEGER NOT NULL,
  payout           TEXT NOT NULL,
  premium          TEXT NOT NULL,
  quoted_price     TEXT,
  resolve_by       INTEGER NOT NULL,
  market_expiry    TEXT,
  status           TEXT NOT NULL,   -- active | paid_out | expired | refunded
  purchase_tx      TEXT NOT NULL,
  purchase_block   INTEGER NOT NULL,
  created_at       INTEGER NOT NULL,
  hedge_status     TEXT NOT NULL,   -- pending | filled | partial | failed
  hedge_mode       TEXT,
  hedge_order_id   TEXT,
  hedge_fill_price TEXT,
  hedge_filled_qty TEXT,
  hedge_error      TEXT,
  hedge_at         INTEGER,
  settle_tx        TEXT,
  settled_at       INTEGER,
  refund_tx        TEXT
);
CREATE INDEX IF NOT EXISTS policies_buyer ON policies(buyer);
CREATE INDEX IF NOT EXISTS policies_status ON policies(status);

CREATE TABLE IF NOT EXISTS markets (
  market_id        TEXT PRIMARY KEY,
  instrument_symbol TEXT NOT NULL,
  event_ticker     TEXT NOT NULL,
  result           INTEGER,         -- 1 yes, 2 no
  resolve_tx       TEXT,
  resolved_at      INTEGER
);

CREATE TABLE IF NOT EXISTS kv (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

export function kvGet(key: string): string | undefined {
  const row = db.prepare("SELECT value FROM kv WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value;
}

export function kvSet(key: string, value: string) {
  db.prepare("INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    key,
    value,
  );
}

export type QuoteRow = {
  nonce: string;
  buyer: string;
  instrument_symbol: string;
  event_ticker: string;
  market_title: string | null;
  market_id: string;
  outcome: number;
  payout: string;
  premium: string;
  price: string;
  spread: string;
  quote_expiry: number;
  resolve_by: number;
  market_expiry: string;
  created_at: number;
  policy_id: number | null;
};

export type PolicyRow = {
  policy_id: number;
  buyer: string;
  instrument_symbol: string;
  event_ticker: string;
  market_title: string | null;
  market_id: string;
  outcome: number;
  payout: string;
  premium: string;
  quoted_price: string | null;
  resolve_by: number;
  market_expiry: string | null;
  status: "active" | "paid_out" | "expired" | "refunded";
  purchase_tx: string;
  purchase_block: number;
  created_at: number;
  hedge_status: "pending" | "filled" | "partial" | "failed";
  hedge_mode: string | null;
  hedge_order_id: string | null;
  hedge_fill_price: string | null;
  hedge_filled_qty: string | null;
  hedge_error: string | null;
  hedge_at: number | null;
  settle_tx: string | null;
  settled_at: number | null;
  refund_tx: string | null;
};

export type MarketRow = {
  market_id: string;
  instrument_symbol: string;
  event_ticker: string;
  result: number | null;
  resolve_tx: string | null;
  resolved_at: number | null;
};

export const now = () => Math.floor(Date.now() / 1000);
