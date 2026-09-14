import { getAddress, type Address } from "viem";
import type { RouteConfig, RoutePreparedSwap, RouteProvider } from "./types.js";

export function executorSet(config: RouteConfig): Set<string> {
  const addrs = [
    ...Object.values(config.executors),
    ...Object.values(config.tokenOutputExecutors ?? {}),
  ];
  return new Set(addrs.map((addr) => getAddress(addr)));
}

export function expectedExecutor(
  config: RouteConfig,
  provider: RouteProvider,
  tokenOutIsNative: boolean,
): Address {
  const map = tokenOutIsNative
    ? config.executors
    : (config.tokenOutputExecutors ?? config.executors);
  const addr = map[provider] ?? config.executors[provider];
  if (!addr) throw new Error(`No Route executor for provider ${provider}`);
  return getAddress(addr);
}

export function assertSafeSwapTargets(
  config: RouteConfig,
  prepared: RoutePreparedSwap,
): void {
  const allowed = executorSet(config);
  const swapTo = getAddress(prepared.transaction.to);
  if (!allowed.has(swapTo)) {
    throw new Error(`Refusing swap target ${swapTo}: not a Route executor`);
  }
  if (prepared.approval) {
    const spender = getAddress(prepared.approval.spender);
    if (!allowed.has(spender)) {
      throw new Error(`Refusing approve spender ${spender}: not a Route executor`);
    }
  }
}

export function isAllowedSpender(config: RouteConfig, spender: Address): boolean {
  return executorSet(config).has(getAddress(spender));
}
