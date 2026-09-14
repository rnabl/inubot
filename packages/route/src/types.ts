import type { Address, Hex } from "viem";

export type RouteProvider =
  | "route"
  | "kyber"
  | "zerox"
  | "nordstern"
  | "kyber-direct";

export type RouteErrorBody = {
  error?: {
    code?: string;
    message?: string;
    requestId?: string;
  };
};

export class RouteApiError extends Error {
  readonly code?: string;
  readonly status: number;
  readonly retryAfter?: number;
  readonly requestId?: string;

  constructor(
    message: string,
    opts: {
      status: number;
      code?: string;
      retryAfter?: number;
      requestId?: string;
    },
  ) {
    super(message);
    this.name = "RouteApiError";
    this.status = opts.status;
    this.code = opts.code;
    this.retryAfter = opts.retryAfter;
    this.requestId = opts.requestId;
  }
}

export type RouteAsset = {
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
  verified: boolean;
  balance?: string;
};

export type RouteTokenList = {
  tokens: RouteAsset[];
  wallet?: Address;
  chainId?: number;
  blockNumber?: string;
  coverage?: string;
  failed?: number;
};

export type RouteConfig = {
  version: number;
  chainId: number;
  name: string;
  rpcUrl?: string;
  explorer?: string | null;
  executors: Record<string, Address>;
  tokenOutputExecutors?: Record<string, Address>;
  feeRecipient: Address;
  enabledProviders: Record<string, boolean>;
  quoteTtlSeconds?: number;
  settlementMode?: string;
  protocolFeeBps?: number | null;
};

export type PlanLeg = {
  adapter: Address;
  tokenOut: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
  nativePool: boolean;
};

export type PlanBranch = {
  amountIn: string;
  legs: PlanLeg[];
};

export type QuoteExecution = {
  status: "simulated" | "unavailable";
  amountOut?: string;
  gasPrice?: string;
};

export type RouteQuote = {
  chainId: number;
  provider: RouteProvider;
  variant?: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  grossAmountOut?: string;
  feeAmount?: string;
  protocolFeeBps: number;
  feeRecipient?: Address;
  expiresAt: number;
  branches: PlanBranch[];
  execution?: QuoteExecution;
};

export type RouteTransaction = {
  to: Address;
  data: Hex;
  value: string;
};

export type RouteApproval = {
  token: Address;
  spender: Address;
  amount: string;
  transaction: RouteTransaction;
};

export type RoutePreparedSwap = {
  chainId: number;
  transaction: RouteTransaction;
  approval: RouteApproval | null;
  simulationRequired: true;
  amountOut: string;
  grossAmountOut: string;
  feeAmount: string;
  protocolFeeBps: number;
  feeRecipient: Address;
  feeTier?: string;
};

export type QuoteParams = {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  provider?: RouteProvider;
};

export type PrepareSwapParams = {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOutMinimum: string;
  recipient: Address;
  deadline: number;
  expiresAt: number;
  branches: PlanBranch[];
  provider: RouteProvider;
  variant?: string;
  txOrigin?: Address;
};
