export function reviewedAmountOut(quote: {
  amountOut: string;
  execution?: { status: string; amountOut?: string };
}): bigint {
  if (quote.execution?.status === "simulated" && quote.execution.amountOut) {
    return BigInt(quote.execution.amountOut);
  }
  return BigInt(quote.amountOut);
}

export function computeMinOut(amountOut: bigint, slippageBps: number): bigint {
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 5000) {
    throw new Error("Slippage must be an integer between 0 and 5000 bps");
  }
  const min = (amountOut * BigInt(10_000 - slippageBps)) / 10_000n;
  if (min <= 0n) throw new Error("Minimum output is too small");
  return min;
}
