import { defineChain, zeroAddress, type Address, type Chain, type Hex } from "viem";

export const ROBINHOOD_CHAIN_ID = 4663;

export const robinhoodMainnet: Chain = defineChain({
  id: ROBINHOOD_CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        "https://rpc.mainnet.chain.robinhood.com",
        "https://api.route.fun/rpc",
      ],
    },
  },
  blockExplorers: {
    default: {
      name: "Blockscout",
      url: "https://robinhoodchain.blockscout.com",
    },
  },
});

export const ZERO_ADDRESS = zeroAddress;
export const NATIVE_ETH = "ETH";
export const ROUTE_API_BASE = "https://api.route.fun";
export const DEFAULT_SLIPPAGE_BPS = 100;
export const DEFAULT_DAILY_CAP_ETH = "0.25";
export const SESSION_TTL_DAYS = 30;
export const SWAP_DEADLINE_SECONDS = 300;
export const APPROVE_SELECTOR = "0x095ea7b3" as Hex;

export const BUY_PRESETS_ETH = ["0.001", "0.005", "0.01"] as const;
export const SELL_PRESETS_BPS = [2500, 5000, 10000] as const;

export const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export function isNativeToken(token: string): boolean {
  return (
    token === NATIVE_ETH ||
    token.toLowerCase() === ZERO_ADDRESS.toLowerCase()
  );
}

export function toRouteToken(token: string): string {
  if (isNativeToken(token)) return NATIVE_ETH;
  return token;
}

export function toAddressToken(token: string): Address {
  if (isNativeToken(token)) return ZERO_ADDRESS;
  return token as Address;
}

export const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
