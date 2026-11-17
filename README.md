# Backstop

**Hedge a real-world event in one click.** Buy cover in USDC on Arc; Backstop prices it from Gemini's live prediction-market odds and hedges it by buying the matching Gemini contracts. If the event happens, the smart contract pays you.

> UBC 2026 Hackathon · Track: DeFi and Onchain Applications · Chain award: Best use of Arc · Bounty: Gemini Prediction Markets

_Work in progress. This README is updated as each milestone lands._

## Repo layout

```
contracts/   Foundry project: Backstop.sol + tests + deploy script
backend/     Node/TypeScript service: Gemini client, quote signer, hedger, resolver (M2)
web/         Next.js app (M4)
```

## Deployed contracts (Arc testnet, chain ID 5042002)

| Contract | Address |
|---|---|
| USDC (ERC-20, 6 decimals, official Circle) | [`0x3600000000000000000000000000000000000000`](https://explorer.testnet.arc.io/address/0x3600000000000000000000000000000000000000) |
| Backstop | _pending deployment_ |

## Smart contract

`contracts/src/Backstop.sol` (Solidity 0.8.24, OpenZeppelin 5.1).

- **Quotes** are EIP-712 typed data signed by the backend's `quoteSigner`:
  `Quote(address buyer, bytes32 marketId, uint8 outcome, uint256 payout, uint256 premium, uint64 quoteExpiry, uint64 resolveBy, uint256 nonce)`, where `marketId = keccak256(instrumentSymbol)` and `outcome` is 1 = YES, 2 = NO.
- `buyPolicy` checks the signature, sender, expiry, nonce, symbol hash, `premium < payout`, the per-policy and per-market caps, and that free liquidity covers the payout. It then pulls the premium and **locks the full payout**.
- `resolveMarket` (resolver only, once per market) and `settle` (anyone) pay the buyer if their outcome happened, otherwise mark the policy Expired. Liquidity is unlocked either way.
- `cancelAndRefund` (resolver only) refunds the premium when the Gemini hedge can't be filled.
- `claimRefund` lets the buyer recover the premium if the market is still unresolved after `resolveBy + refundGracePeriod`. This protects buyers if the relayer goes down.
- `withdrawTreasury` can only move **free** liquidity. Funds locked for open policies can never leave.

Invariant: `lockedLiquidity ≤ USDC balance`, and every open policy is always fully payable (or refundable, since `premium < payout`).

### Run the tests

```bash
cd contracts
forge test -vv
```

28 tests cover: payout, losing policy, NO-side cover, bad and tampered signatures, expired quote, replayed nonce, wrong sender, symbol mismatch, caps, insufficient liquidity, cancel and refund, timeout refund, treasury withdrawal against locked funds, admin access control, signer rotation, plus a fuzz test of the liquidity accounting.

## Setup

Requirements: Foundry, Node 22+, pnpm (`corepack pnpm` works without a global install).

```bash
git clone --recurse-submodules <repo>
cd backstop
cp .env.example .env   # fill in keys
cd contracts && forge test
```

### Deploy to Arc testnet

```bash
set -a; source .env; set +a
cd contracts
forge script script/Deploy.s.sol --rpc-url "$ARC_RPC_URL" --broadcast
```

## How Backstop uses Arc

- USDC is both the gas token and the settlement asset, so a buyer only ever needs one balance. Fees are predictable and denominated in dollars.
- The contract uses the official Circle USDC ERC-20 at `0x3600…0000` (6 decimals). Arc's native gas balance is the same USDC at 18 decimals, so the app shows one USDC balance.

_Economic design, risk assumptions, architecture diagram and backend/frontend docs: coming in later milestones._
