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

export type PendingWithdraw = {
  id: number;
  telegramId: string;
  type: "quick" | "custom" | "set_address";
  recipient?: string;
  amount?: string;
  createdAt: number;
};

const pending = new Map<string, PendingSwap>();
const pendingWithdraw = new Map<string, PendingWithdraw>();
let nextId = 1;
let nextWithdrawId = 1;

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

export function createPendingWithdraw(partial: Omit<PendingWithdraw, "id" | "createdAt">): PendingWithdraw {
  const item: PendingWithdraw = {
    ...partial,
    id: nextWithdrawId++,
    createdAt: Date.now(),
  };
  pendingWithdraw.set(key(item.telegramId, item.id), item);
  return item;
}

export function getPendingWithdraw(telegramId: string, id: number): PendingWithdraw | undefined {
  const item = pendingWithdraw.get(key(telegramId, id));
  if (!item) return undefined;
  if (Date.now() - item.createdAt > 10 * 60 * 1000) {
    pendingWithdraw.delete(key(telegramId, id));
    return undefined;
  }
  return item;
}

export function getAnyPendingWithdraw(telegramId: string): PendingWithdraw | undefined {
  for (const [k, item] of pendingWithdraw.entries()) {
    if (item.telegramId === telegramId && Date.now() - item.createdAt <= 10 * 60 * 1000) {
      return item;
    }
  }
  return undefined;
}

export function updatePendingWithdraw(item: PendingWithdraw): void {
  pendingWithdraw.set(key(item.telegramId, item.id), item);
}

export function clearPendingWithdraw(telegramId: string, id: number): void {
  pendingWithdraw.delete(key(telegramId, id));
}
