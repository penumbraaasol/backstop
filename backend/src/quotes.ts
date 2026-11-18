// Prices cover from the live Gemini ask and signs an EIP-712 quote the contract will accept.
import { randomBytes } from "node:crypto";
import { getAddress, type Address, type Hex } from "viem";
import { cfg } from "./config.js";
import {
  arcTestnet,
  backstopAbi,
  backstopAddress,
  marketIdOf,
  OUTCOME,
  publicClient,
  signerAccount,
  USDC_UNIT,
  type OutcomeName,
} from "./chain.js";
import { db, now } from "./db.js";
import { askFor, contractExpiry, getContract, isTradable, venueCanHedge } from "./gemini/public.js";

export class QuoteError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const MICRO = 1_000_000;
const toMicro = (x: number) => BigInt(Math.round(x * MICRO));
export const formatUsdc = (base: bigint) => (Number(base) / Number(USDC_UNIT)).toFixed(2);

export type QuoteRequest = {
  buyer: string;
  instrumentSymbol: string;
  outcome: OutcomeName;
  payout: number; // whole USDC
  eventTicker?: string;
};

export async function makeQuote(req: QuoteRequest) {
  const buyer = getAddress(req.buyer) as Address;
  if (!Number.isInteger(req.payout) || req.payout <= 0) throw new QuoteError("payout must be a positive whole number of USDC", "bad_payout");

  // 1. Live market data from Gemini production.
  const { event, contract } = await getContract(req.instrumentSymbol, req.eventTicker);
  if (!isTradable(contract)) throw new QuoteError("market is not open for trading", "market_closed");
  const expiry = contractExpiry(event, contract);
  if (!expiry) throw new QuoteError("market has no expiry", "no_expiry");
  const secondsLeft = Math.floor((expiry.getTime() - Date.now()) / 1000);
  if (secondsLeft < cfg.MIN_SECONDS_TO_EXPIRY) {
    throw new QuoteError(`market closes in ${secondsLeft}s; too late to hedge`, "too_late");
  }
  const p = askFor(contract, req.outcome);
  if (p == null) throw new QuoteError(`no ask for ${req.outcome.toUpperCase()} on Gemini`, "no_liquidity");

  // only sell cover we can hedge: the venue's ask must be within MAX_SLIPPAGE of the quoted price
  const venue = await venueCanHedge(contract.instrumentSymbol, req.outcome, p, event.ticker).catch(() => ({ ok: false, via: cfg.HEDGE_MODE, ask: undefined }));
  if (!venue.ok) {
    throw new QuoteError(
      `This side can't be hedged right now: the Gemini ${cfg.HEDGE_MODE} book asks ${venue.ask?.toFixed(2) ?? "nothing"} vs ${p.toFixed(2)} quoted. Try another market.`,
      "unhedgeable",
      409,
    );
  }

  // 2. Pricing: premium = N * (p + s). Integer math in USDC base units (6 decimals).
  const pMicro = toMicro(p);
  const sMicro = toMicro(cfg.SPREAD);
  if (pMicro + sMicro >= BigInt(MICRO)) {
    throw new QuoteError(`price ${p} + spread ${cfg.SPREAD} >= 1; cover would cost more than it pays`, "too_expensive");
  }
  const N = BigInt(req.payout);
  const payout = N * USDC_UNIT;
  const premium = N * (pMicro + sMicro);
  const hedgeCost = N * pMicro;
  const margin = N * sMicro;

  // 3. Onchain pre-checks so the user gets a clear error instead of a revert.
  const marketId = marketIdOf(contract.instrumentSymbol);
  const read = (functionName: string, args: readonly unknown[] = []) =>
    publicClient.readContract({ address: backstopAddress, abi: backstopAbi, functionName: functionName as never, args: args as never });
  const [maxPayout, maxExposure, exposure, free, resolved] = (await Promise.all([
    read("maxPayoutPerPolicy"),
    read("maxExposurePerMarket"),
    read("marketExposure", [marketId]),
    read("freeLiquidity"),
    read("marketResult", [marketId]),
  ])) as [bigint, bigint, bigint, bigint, number];
  if (resolved !== 0) throw new QuoteError("market already resolved onchain", "resolved");
  if (payout > maxPayout) throw new QuoteError(`max payout per policy is ${formatUsdc(maxPayout)} USDC`, "payout_cap");
  if (exposure + payout > maxExposure) {
    throw new QuoteError(`market capacity left: ${formatUsdc(maxExposure - exposure)} USDC`, "market_cap");
  }
  if (free < payout) throw new QuoteError(`protocol liquidity left: ${formatUsdc(free)} USDC`, "liquidity");

  // 4. Sign.
  const t = now();
  const quote = {
    buyer,
    marketId,
    outcome: OUTCOME[req.outcome],
    payout,
    premium,
    quoteExpiry: BigInt(t + cfg.QUOTE_TTL_SECONDS),
    resolveBy: BigInt(Math.floor(expiry.getTime() / 1000) + cfg.RESOLVE_BUFFER_SECONDS),
    nonce: BigInt(`0x${randomBytes(16).toString("hex")}`),
  };
  const signature: Hex = await signerAccount.signTypedData({
    domain: { name: "Backstop", version: "1", chainId: arcTestnet.id, verifyingContract: backstopAddress },
    types: {
      Quote: [
        { name: "buyer", type: "address" },
        { name: "marketId", type: "bytes32" },
        { name: "outcome", type: "uint8" },
        { name: "payout", type: "uint256" },
        { name: "premium", type: "uint256" },
        { name: "quoteExpiry", type: "uint64" },
        { name: "resolveBy", type: "uint64" },
        { name: "nonce", type: "uint256" },
      ],
    },
    primaryType: "Quote",
    message: quote,
  });

  db.prepare(
    `INSERT INTO quotes(nonce, buyer, instrument_symbol, event_ticker, market_title, market_id, outcome, payout, premium,
       price, spread, quote_expiry, resolve_by, market_expiry, created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    quote.nonce.toString(),
    buyer.toLowerCase(),
    contract.instrumentSymbol,
    event.ticker,
    event.title,
    marketId,
    quote.outcome,
    payout.toString(),
    premium.toString(),
    String(p),
    String(cfg.SPREAD),
    Number(quote.quoteExpiry),
    Number(quote.resolveBy),
    expiry.toISOString(),
    t,
  );

  return {
    instrumentSymbol: contract.instrumentSymbol,
    contractAddress: backstopAddress,
    chainId: arcTestnet.id,
    signature,
    quote: {
      buyer,
      marketId,
      outcome: quote.outcome,
      payout: payout.toString(),
      premium: premium.toString(),
      quoteExpiry: quote.quoteExpiry.toString(),
      resolveBy: quote.resolveBy.toString(),
      nonce: quote.nonce.toString(),
    },
    breakdown: {
      payoutUsdc: formatUsdc(payout),
      price: p,
      spread: cfg.SPREAD,
      premiumUsdc: formatUsdc(premium),
      hedgeCostUsdc: formatUsdc(hedgeCost),
      marginUsdc: formatUsdc(margin),
      formula: `${req.payout} × (${p} + ${cfg.SPREAD}) = ${formatUsdc(premium)} USDC`,
    },
    market: {
      eventTicker: event.ticker,
      title: event.title,
      label: contract.label,
      expiry: expiry.toISOString(),
      strike: contract.strike?.value ?? null,
    },
  };
}
