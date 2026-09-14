import type { RouteAsset, RouteQuote } from "@inubot/route";

export type PendingSwap = {
  id: number;
  telegramId: string;
  side: "buy" | "sell";
  token: RouteAsset;
  amountIn: string;
  quote?: RouteQuote;
  createdAt: number;
};

const pending = new Map<string, PendingSwap>();
let nextId = 1;

function key(telegramId: string, id: number): string {
  return `${telegramId}:${id}`;
}

export function createPending(partial: Omit<PendingSwap, "id" | "createdAt">): PendingSwap {
  const item: PendingSwap = {
    ...partial,
    id: nextId++,
    createdAt: Date.now(),
  };
  pending.set(key(item.telegramId, item.id), item);
  return item;
}

export function getPending(telegramId: string, id: number): PendingSwap | undefined {
  const item = pending.get(key(telegramId, id));
  if (!item) return undefined;
  if (Date.now() - item.createdAt > 10 * 60 * 1000) {
    pending.delete(key(telegramId, id));
    return undefined;
  }
  return item;
}

export function updatePending(item: PendingSwap): void {
  pending.set(key(item.telegramId, item.id), item);
}

export function clearPending(telegramId: string, id: number): void {
  pending.delete(key(telegramId, id));
}
