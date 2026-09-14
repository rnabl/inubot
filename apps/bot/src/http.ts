import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "@hono/node-server/serve-static";
import { prisma } from "@inubot/db";
import { RouteClient } from "@inubot/route";
import { DEFAULT_DAILY_CAP_ETH, SESSION_TTL_DAYS } from "@inubot/shared";
import { buildSessionPermissions, encryptSecret, generateSessionKey } from "@inubot/wallet";
import { parseEther } from "viem";
import type { Env } from "./env.js";
import { verifyCeremonyToken } from "./ceremony-token.js";
import { getAnyPendingWithdraw, clearPendingWithdraw } from "./pending.js";

export function createHttpApp(env: Env) {
  const app = new Hono();
  const route = new RouteClient({ baseUrl: env.ROUTE_API_BASE });

  app.use(
    "/api/*",
    cors({
      origin: (origin) => origin || "*",
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type"],
    }),
  );

  app.get("/health", (c) => c.json({ ok: true }));

  // Serve ceremony static files
  app.use("/*", serveStatic({ root: "../ceremony/dist" }));

  app.get("/api/ceremony/bootstrap", async (c) => {
    const token = c.req.query("t");
    if (!token) return c.json({ error: "Missing token" }, 400);
    const { telegramId } = verifyCeremonyToken(token, env.CEREMONY_SECRET);

    const existing = await prisma.user.findUnique({
      where: { telegramId },
      include: { wallet: true },
    });
    if (existing?.wallet) {
      return c.json({
        alreadySetup: true,
        address: existing.wallet.address,
        telegramId,
      });
    }

    const config = await route.getConfig();
    const dailyCapWei = parseEther(env.DEFAULT_DAILY_CAP_ETH || DEFAULT_DAILY_CAP_ETH);
    const lifetimeWei = dailyCapWei * BigInt(SESSION_TTL_DAYS);
    const session = generateSessionKey();
    const blob = encryptSecret(session.privateKey, env.SESSION_KEY_SECRET);
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

    await prisma.ceremonyNonce.upsert({
      where: { token },
      create: {
        token,
        telegramId,
        sessionPublicAddress: session.account.address,
        encryptedPrivateKey: blob.ciphertext,
        iv: blob.iv,
        tag: blob.tag,
        expiresAt,
      },
      update: {
        sessionPublicAddress: session.account.address,
        encryptedPrivateKey: blob.ciphertext,
        iv: blob.iv,
        tag: blob.tag,
        expiresAt,
        consumedAt: null,
      },
    });

    return c.json({
      alreadySetup: false,
      telegramId,
      rpId: env.CEREMONY_RP_ID,
      alchemyApiKey: env.ALCHEMY_API_KEY,
      policyId: env.ALCHEMY_GAS_POLICY_ID || null,
      sessionPublicKey: session.account.address,
      dailyCapEth: env.DEFAULT_DAILY_CAP_ETH,
      dailyCapWei: dailyCapWei.toString(),
      lifetimeAllowanceWei: lifetimeWei.toString(),
      expirySec: Math.floor(expiresAt.getTime() / 1000),
      permissions: buildSessionPermissions(config, lifetimeWei),
      chainId: 4663,
    });
  });

  app.post("/api/ceremony/complete", async (c) => {
    const body = await c.req.json<{
      token?: string;
      address?: string;
      credentialId?: string;
      publicKey?: string;
      permissions?: unknown;
    }>();
    if (!body.token || !body.address) {
      return c.json({ error: "Missing token or address" }, 400);
    }

    const { telegramId } = verifyCeremonyToken(body.token, env.CEREMONY_SECRET);
    const nonce = await prisma.ceremonyNonce.findUnique({ where: { token: body.token } });
    if (!nonce || nonce.telegramId !== telegramId) {
      return c.json({ error: "Unknown ceremony session" }, 400);
    }
    if (nonce.consumedAt) {
      return c.json({ error: "Ceremony already completed" }, 409);
    }
    if (nonce.expiresAt.getTime() <= Date.now()) {
      return c.json({ error: "Ceremony expired" }, 400);
    }

    const dailyCapWei = parseEther(env.DEFAULT_DAILY_CAP_ETH || DEFAULT_DAILY_CAP_ETH);
    const lifetimeWei = dailyCapWei * BigInt(SESSION_TTL_DAYS);

    const user = await prisma.user.upsert({
      where: { telegramId },
      create: { telegramId, slippageBps: env.DEFAULT_SLIPPAGE_BPS },
      update: {},
    });

    const wallet = await prisma.wallet.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        address: body.address,
        credentialId: body.credentialId,
        publicKey: body.publicKey,
      },
      update: {
        address: body.address,
        credentialId: body.credentialId,
        publicKey: body.publicKey,
      },
    });

    await prisma.sessionKey.updateMany({
      where: { walletId: wallet.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await prisma.sessionKey.create({
      data: {
        walletId: wallet.id,
        publicAddress: nonce.sessionPublicAddress,
        encryptedPrivateKey: nonce.encryptedPrivateKey,
        iv: nonce.iv,
        tag: nonce.tag,
        permissionsJson: JSON.stringify(body.permissions ?? {}),
        permissionsContext: typeof body.permissions === 'object' && body.permissions !== null && 'context' in body.permissions
          ? JSON.stringify((body.permissions as any).context)
          : null,
        dailyCapWei: dailyCapWei.toString(),
        lifetimeAllowanceWei: lifetimeWei.toString(),
        expiresAt: nonce.expiresAt,
      },
    });

    await prisma.ceremonyNonce.update({
      where: { token: body.token },
      data: { consumedAt: new Date() },
    });

    return c.json({ ok: true, address: wallet.address });
  });

  app.get("/api/withdraw/bootstrap", async (c) => {
    const token = c.req.query("t");
    if (!token) return c.json({ error: "Missing token" }, 400);
    const { telegramId } = verifyCeremonyToken(token, env.CEREMONY_SECRET);

    const user = await prisma.user.findUnique({
      where: { telegramId },
      include: { wallet: true },
    });
    if (!user?.wallet) {
      return c.json({ error: "No wallet found" }, 404);
    }

    const pending = getAnyPendingWithdraw(telegramId);
    if (!pending || !pending.recipient || !pending.amount) {
      return c.json({ error: "No pending withdrawal" }, 404);
    }

    return c.json({
      telegramId,
      walletAddress: user.wallet.address,
      rpId: env.CEREMONY_RP_ID,
      alchemyApiKey: env.ALCHEMY_API_KEY,
      policyId: env.ALCHEMY_GAS_POLICY_ID || null,
      recipient: pending.recipient,
      amount: pending.amount,
      chainId: 4663,
      credentialId: user.wallet.credentialId,
      publicKey: user.wallet.publicKey,
    });
  });

  app.post("/api/withdraw/execute", async (c) => {
    const body = await c.req.json<{
      token?: string;
      txHash?: string;
    }>();
    if (!body.token || !body.txHash) {
      return c.json({ error: "Missing token or txHash" }, 400);
    }

    const { telegramId } = verifyCeremonyToken(body.token, env.CEREMONY_SECRET);
    const pending = getAnyPendingWithdraw(telegramId);
    if (!pending) {
      return c.json({ error: "No pending withdrawal" }, 404);
    }

    // Clear the pending withdrawal
    clearPendingWithdraw(telegramId, pending.id);

    return c.json({ ok: true, txHash: body.txHash });
  });

  return app;
}
