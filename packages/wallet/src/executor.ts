import { ERC20_ABI, SWAP_DEADLINE_SECONDS, isNativeToken, toAddressToken } from "@inubot/shared";
import {
  RouteClient,
  assertSafeSwapTargets,
  computeMinOut,
  reviewedAmountOut,
  type RouteConfig,
  type RoutePreparedSwap,
  type RouteQuote,
} from "@inubot/route";
import { encodeFunctionData, type Address, type Hex, type PublicClient } from "viem";
import { assertCallsAreRouteScoped } from "./permissions.js";
import { createSessionWalletClient } from "./session.js";
import type { PrivateKeyAccount } from "viem/accounts";

export type SwapIntent = {
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  recipient: Address;
  slippageBps: number;
};

export type PreparedExecution = {
  quote: RouteQuote;
  prepared: RoutePreparedSwap;
  minOut: bigint;
  calls: { to: Address; data: Hex; value: bigint }[];
};

export async function quoteAndBuildSwap(
  route: RouteClient,
  config: RouteConfig,
  intent: SwapIntent,
): Promise<PreparedExecution> {
  const quote = await route.getQuote({
    tokenIn: intent.tokenIn,
    tokenOut: intent.tokenOut,
    amountIn: intent.amountIn.toString(),
  });
  if (!Number.isSafeInteger(quote.expiresAt) || quote.expiresAt <= Math.floor(Date.now() / 1000)) {
    throw new Error("Quote expired before confirmation");
  }

  const minOut = computeMinOut(reviewedAmountOut(quote), intent.slippageBps);
  const deadline = Math.floor(Date.now() / 1000) + SWAP_DEADLINE_SECONDS;
  const prepared = await route.prepareSwap({
    tokenIn: intent.tokenIn,
    tokenOut: intent.tokenOut,
    amountIn: intent.amountIn.toString(),
    amountOutMinimum: minOut.toString(),
    recipient: intent.recipient,
    deadline,
    expiresAt: quote.expiresAt,
    branches: quote.branches ?? [],
    provider: quote.provider,
    variant: quote.variant,
  });

  assertSafeSwapTargets(config, prepared);

  const calls: { to: Address; data: Hex; value: bigint }[] = [];
  if (prepared.approval) {
    calls.push({
      to: prepared.approval.token,
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [prepared.approval.spender, BigInt(prepared.approval.amount)],
      }),
      value: 0n,
    });
  }
  calls.push({
    to: prepared.transaction.to,
    data: prepared.transaction.data,
    value: BigInt(prepared.transaction.value),
  });

  assertCallsAreRouteScoped(config, calls);
  return { quote, prepared, minOut, calls };
}

export async function simulateSwapCalls(
  publicClient: PublicClient,
  from: Address,
  calls: { to: Address; data: Hex; value: bigint }[],
): Promise<void> {
  for (const call of calls) {
    await publicClient.call({
      account: from,
      to: call.to,
      data: call.data,
      value: call.value,
    });
    await publicClient.estimateGas({
      account: from,
      to: call.to,
      data: call.data,
      value: call.value,
    });
  }
}

export async function assertSpendableBalance(
  publicClient: PublicClient,
  owner: Address,
  tokenIn: string,
  amountIn: bigint,
): Promise<void> {
  if (isNativeToken(tokenIn)) {
    const balance = await publicClient.getBalance({ address: owner });
    if (balance < amountIn) {
      throw new Error("Insufficient ETH balance");
    }
    return;
  }
  const balance = await publicClient.readContract({
    address: toAddressToken(tokenIn),
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [owner],
  });
  if (balance < amountIn) {
    throw new Error("Insufficient token balance");
  }
}

export async function submitSessionCalls(opts: {
  apiKey: string;
  policyId?: string;
  account: Address;
  signer: PrivateKeyAccount;
  calls: { to: Address; data: Hex; value: bigint }[];
  permissionsContext?: Hex;
}): Promise<{ id: string }> {
  const client = createSessionWalletClient({
    apiKey: opts.apiKey,
    policyId: opts.policyId,
    account: opts.account,
    signer: opts.signer,
  });

  const { id} = await client.sendCalls({
    calls: opts.calls,
    ...(opts.permissionsContext ? {
      capabilities: {
        permissions: {
          context: opts.permissionsContext,
        },
      },
    } : {}),
  });
  return { id };
}

export async function waitForCall(opts: {
  apiKey: string;
  policyId?: string;
  account: Address;
  signer: PrivateKeyAccount;
  id: string;
}) {
  const client = createSessionWalletClient({
    apiKey: opts.apiKey,
    policyId: opts.policyId,
    account: opts.account,
    signer: opts.signer,
  });
  return client.waitForCallsStatus({ id: opts.id });
}
