import { APPROVE_SELECTOR } from "@inubot/shared";
import { getAddress, type Address, type Hex } from "viem";
import { executorSet, type RouteConfig } from "@inubot/route";

export type SessionPermission =
  | { type: "native-token-transfer"; data: { allowance: bigint } }
  | { type: "contract-access"; data: { address: Address } }
  | { type: "functions-on-all-contracts"; data: { functions: Hex[] } };

export function buildSessionPermissions(
  config: RouteConfig,
  lifetimeAllowanceWei: bigint,
): SessionPermission[] {
  const executors = [...executorSet(config)] as Address[];
  return [
    {
      type: "native-token-transfer",
      data: { allowance: lifetimeAllowanceWei },
    },
    {
      type: "functions-on-all-contracts",
      data: { functions: [APPROVE_SELECTOR] },
    },
    ...executors.map((address) => ({
      type: "contract-access" as const,
      data: { address },
    })),
  ];
}

export function decodeApproveSpender(data: Hex): Address | null {
  const raw = data.toLowerCase();
  if (!raw.startsWith(APPROVE_SELECTOR) || raw.length < 74) return null;
  return getAddress(`0x${raw.slice(34, 74)}`);
}

export function assertCallsAreRouteScoped(
  config: RouteConfig,
  calls: { to: Address; data?: Hex }[],
): void {
  const allowed = executorSet(config);
  for (const call of calls) {
    const to = getAddress(call.to);
    if (allowed.has(to)) continue;
    const spender = call.data ? decodeApproveSpender(call.data) : null;
    if (spender && allowed.has(spender)) continue;
    throw new Error(`Refusing call to ${to}: not a Route executor or Route approve`);
  }
}
