export function utcDay(date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function remainingDailyCap(dailyCapWei: bigint, spentWei: bigint): bigint {
  return dailyCapWei > spentWei ? dailyCapWei - spentWei : 0n;
}

export function assertWithinDailyCap(dailyCapWei: bigint, spentWei: bigint, nextWei: bigint): void {
  if (spentWei + nextWei > dailyCapWei) {
    throw new Error("This swap exceeds today's session-key cap. Raise it with Face ID.");
  }
}
