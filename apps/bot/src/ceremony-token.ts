import { createHmac, timingSafeEqual } from "node:crypto";

export function signCeremonyToken(telegramId: string, secret: string, ttlSeconds = 30 * 60): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${telegramId}.${exp}`;
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyCeremonyToken(token: string, secret: string): { telegramId: string; exp: number } {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid ceremony token");
  const [telegramId, expRaw, sig] = parts;
  if (!telegramId || !expRaw || !sig) throw new Error("Invalid ceremony token");
  const payload = `${telegramId}.${expRaw}`;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error("Invalid ceremony token");
  }
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) {
    throw new Error("Ceremony link expired");
  }
  return { telegramId, exp };
}
