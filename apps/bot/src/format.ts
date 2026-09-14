import { formatUnits, parseEther } from "viem";

export function formatTokenAmount(raw: string | bigint, decimals: number, maxFrac = 6): string {
  const value = formatUnits(BigInt(raw), decimals);
  const [whole, frac = ""] = value.split(".");
  if (!frac || maxFrac === 0) return whole ?? value;
  const trimmed = frac.slice(0, maxFrac).replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : (whole ?? value);
}

export function parseEthAmount(input: string): bigint {
  return parseEther(input);
}

export function explorerTx(hash: string): string {
  return `https://robinhoodchain.blockscout.com/tx/${hash}`;
}

export function explorerAddress(address: string): string {
  return `https://robinhoodchain.blockscout.com/address/${address}`;
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function feeLine(bps: number): string {
  return `${(bps / 100).toFixed(2)}% Route fee`;
}
