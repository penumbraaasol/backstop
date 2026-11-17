import { createPublicClient, defineChain, http } from "viem";
import { injected } from "wagmi/connectors/injected";
import { createConfig } from "wagmi";

export const ARC_RPC = "https://rpc.testnet.arc.io";
export const ARC_EXPLORER = "https://explorer.testnet.arc.io";

/** Arc testnet. Native gas is USDC (18 decimals natively; the ERC-20 view uses 6). */
export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC] } },
  blockExplorers: { default: { name: "Arcscan", url: ARC_EXPLORER } },
  testnet: true,
});

export const BACKSTOP_ADDRESS = "0x3c7cdb6658BbcE924dCBD6327FCc5B72B3624A05" as const;
export const USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as const;
export const FAUCET_URL = "https://faucet.circle.com";

export const wagmiConfig = createConfig({
  chains: [arcTestnet],
  connectors: [injected()],
  transports: { [arcTestnet.id]: http(ARC_RPC) },
  ssr: true,
});

export const publicClient = createPublicClient({ chain: arcTestnet, transport: http(ARC_RPC) });

export const txUrl = (hash: string) => `${ARC_EXPLORER}/tx/${hash}`;
export const addressUrl = (a: string) => `${ARC_EXPLORER}/address/${a}`;

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
