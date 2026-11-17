import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  keccak256,
  toBytes,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { backstopAbi } from "./abi.js";
import { cfg } from "./config.js";

export const arcTestnet = defineChain({
  id: cfg.ARC_CHAIN_ID,
  name: "Arc Testnet",
  // Native gas token is USDC with 18 decimals (the ERC-20 view of the same balance uses 6).
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [cfg.ARC_RPC_URL] } },
  blockExplorers: { default: { name: "Arcscan", url: cfg.ARC_EXPLORER_URL } },
  testnet: true,
});

export const publicClient = createPublicClient({ chain: arcTestnet, transport: http(cfg.ARC_RPC_URL) });

export const signerAccount = privateKeyToAccount(cfg.PRIVATE_KEY_SIGNER as Hex);
export const resolverAccount = privateKeyToAccount(cfg.PRIVATE_KEY_RESOLVER as Hex);

export const resolverWallet = createWalletClient({
  account: resolverAccount,
  chain: arcTestnet,
  transport: http(cfg.ARC_RPC_URL),
});

export const backstopAddress = cfg.BACKSTOP_ADDRESS as Address;
export const usdcAddress = cfg.USDC_ADDRESS as Address;
export { backstopAbi };

export const OUTCOME = { yes: 1, no: 2 } as const;
export type OutcomeName = keyof typeof OUTCOME;
export const outcomeName = (n: number): OutcomeName => (n === 1 ? "yes" : "no");

export const marketIdOf = (instrumentSymbol: string): Hex => keccak256(toBytes(instrumentSymbol));

export const USDC_DECIMALS = 6;
export const USDC_UNIT = 1_000_000n;

export const txUrl = (hash: string) => `${cfg.ARC_EXPLORER_URL}/tx/${hash}`;

/** Send a resolver tx and wait for it to be mined. Throws if it reverts. */
export async function resolverWrite(
  functionName: "resolveMarket" | "settle" | "cancelAndRefund",
  args: readonly unknown[],
): Promise<Hex> {
  const { request } = await publicClient.simulateContract({
    address: backstopAddress,
    abi: backstopAbi,
    functionName,
    args: args as never,
    account: resolverAccount,
  });
  const hash = await resolverWallet.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${functionName} reverted: ${hash}`);
  return hash;
}
