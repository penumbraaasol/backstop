// One interface for the three HEDGE_MODEs: simulated, sandbox, live.
import { cfg } from "../config.js";
import * as priv from "../gemini/private.js";
import { askFor, getContract, isTradable } from "../gemini/public.js";

export type HedgeRequest = {
  symbol: string;
  eventTicker: string;
  outcome: "yes" | "no";
  quantity: number; // contracts = payout in whole USDC
  limitPrice: number; // quoted p + MAX_SLIPPAGE, capped at 0.99
};

export type HedgeResult =
  | { ok: true; orderId: string; filledQuantity: number; avgPrice: number; partial: boolean; detail?: unknown }
  | { ok: false; orderId?: string; reason: string; detail?: unknown };

export interface HedgeVenue {
  readonly mode: "simulated" | "sandbox" | "live";
  hedge(req: HedgeRequest): Promise<HedgeResult>;
}

/** Gemini prices use a 0.01 grid; never round a buy limit up past what we quoted. */
export const priceStr = (p: number) => (Math.floor(p * 100 + 1e-9) / 100).toFixed(2);

/** No order is sent. Fills at the live production ask if it is within the limit, else fails. */
class SimulatedVenue implements HedgeVenue {
  readonly mode = "simulated" as const;
  async hedge(req: HedgeRequest): Promise<HedgeResult> {
    const orderId = `sim-${Date.now().toString(36)}`;
    if (cfg.SIMULATE_HEDGE_FAILURE) return { ok: false, orderId, reason: "simulated failure (SIMULATE_HEDGE_FAILURE)" };
    const { contract } = await getContract(req.symbol, req.eventTicker);
    if (!isTradable(contract)) return { ok: false, orderId, reason: `market not open (${contract.status}/${contract.marketState})` };
    const ask = askFor(contract, req.outcome);
    if (ask == null) return { ok: false, orderId, reason: "no ask on Gemini" };
    if (ask > req.limitPrice + 1e-9) {
      return { ok: false, orderId, reason: `ask ${ask} above limit ${priceStr(req.limitPrice)}` };
    }
    return { ok: true, orderId, filledQuantity: req.quantity, avgPrice: ask, partial: false };
  }
}

/** Real Gemini order (sandbox or production). */
class GeminiVenue implements HedgeVenue {
  constructor(readonly mode: "sandbox" | "live") {}
  private get env(): priv.GeminiEnv {
    return this.mode === "live" ? "production" : "sandbox";
  }

  async hedge(req: HedgeRequest): Promise<HedgeResult> {
    if (this.mode === "live" && req.quantity > cfg.MAX_LIVE_CONTRACTS) {
      return { ok: false, reason: `quantity ${req.quantity} exceeds MAX_LIVE_CONTRACTS=${cfg.MAX_LIVE_CONTRACTS}` };
    }
    await priv.ensureTerms(this.env);
    let order = await priv.placeLimitBuy(this.env, {
      symbol: req.symbol,
      outcome: req.outcome,
      quantity: String(req.quantity),
      price: priceStr(req.limitPrice),
      timeInForce: cfg.HEDGE_TIME_IN_FORCE,
    });

    // FOK / IOC orders are terminal immediately; GTC orders get a fill window, then a cancel.
    const deadline = Date.now() + cfg.HEDGE_FILL_TIMEOUT_MS;
    while (order.status === "open" && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1_500));
      order = (await priv.getOrder(this.env, order.orderId, req.symbol)) ?? order;
    }
    if (order.status === "open") {
      await priv.cancelOrder(this.env, order.orderId).catch(() => undefined);
      order = (await priv.getOrder(this.env, order.orderId, req.symbol)) ?? order;
    }

    if (order.filledQuantity <= 0) {
      return { ok: false, orderId: order.orderId, reason: `not filled (status ${order.status})`, detail: order.raw };
    }
    return {
      ok: true,
      orderId: order.orderId,
      filledQuantity: order.filledQuantity,
      avgPrice: order.avgExecutionPrice ?? req.limitPrice,
      partial: order.filledQuantity + 1e-9 < req.quantity,
      detail: order.raw,
    };
  }
}

export function makeVenue(): HedgeVenue {
  switch (cfg.HEDGE_MODE) {
    case "live":
      return new GeminiVenue("live");
    case "sandbox":
      return new GeminiVenue("sandbox");
    default:
      return new SimulatedVenue();
  }
}
