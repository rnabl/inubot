import { prisma } from "@inubot/db";
import { RouteClient } from "@inubot/route";
import {
  assertSpendableBalance,
  assertWithinDailyCap,
  createRobinhoodPublicClient,
  decryptSecret,
  quoteAndBuildSwap,
  remainingDailyCap,
  sessionAccountFromPrivateKey,
  simulateSwapCalls,
  submitSessionCalls,
  utcDay,
  waitForCall,
  type EncryptedBlob,
} from "@inubot/wallet";
import { parseEther, type Address, type Hex } from "viem";
import type { Env } from "./env.js";
import { activeSession, getUserByTelegram } from "./users.js";

export function remainingForUser(
  session: { dailyCapWei: string },
  spentWei: bigint,
): bigint {
  return remainingDailyCap(BigInt(session.dailyCapWei), spentWei);
}

export async function spentToday(walletId: string): Promise<bigint> {
  const row = await prisma.dailySpend.findUnique({
    where: { walletId_day: { walletId, day: utcDay() } },
  });
  return row ? BigInt(row.spentWei) : 0n;
}

export async function addSpend(walletId: string, amountWei: bigint): Promise<void> {
  const day = utcDay();
  const current = await prisma.dailySpend.findUnique({
    where: { walletId_day: { walletId, day } },
  });
  if (!current) {
    await prisma.dailySpend.create({
      data: { walletId, day, spentWei: amountWei.toString() },
    });
    return;
  }
  await prisma.dailySpend.update({
    where: { id: current.id },
    data: { spentWei: (BigInt(current.spentWei) + amountWei).toString() },
  });
}

export async function executeSwap(opts: {
  env: Env;
  telegramId: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
}) {
  const user = await getUserByTelegram(opts.telegramId);
  const wallet = user?.wallet;
  const session = activeSession(user);
  if (!wallet || !session) {
    throw new Error("Create a wallet first with /start");
  }

  const spent = await spentToday(wallet.id);
  const ethValue = opts.tokenIn === "ETH" || opts.tokenIn.toLowerCase() === "0x0000000000000000000000000000000000000000"
    ? opts.amountIn
    : 0n;
  if (ethValue > 0n) {
    assertWithinDailyCap(BigInt(session.dailyCapWei), spent, ethValue);
  }

  const route = new RouteClient({ baseUrl: opts.env.ROUTE_API_BASE });
  const config = await route.getConfig();
  const built = await quoteAndBuildSwap(route, config, {
    tokenIn: opts.tokenIn,
    tokenOut: opts.tokenOut,
    amountIn: opts.amountIn,
    recipient: wallet.address as Address,
    slippageBps: user.slippageBps,
  });

  const publicClient = createRobinhoodPublicClient(opts.env.RPC_URL || undefined);
  await assertSpendableBalance(
    publicClient,
    wallet.address as Address,
    opts.tokenIn,
    opts.amountIn,
  );
  await simulateSwapCalls(publicClient, wallet.address as Address, built.calls);

  const privateKey = decryptSecret(
    {
      ciphertext: session.encryptedPrivateKey,
      iv: session.iv,
      tag: session.tag,
    } satisfies EncryptedBlob,
    opts.env.SESSION_KEY_SECRET,
  ) as Hex;
  const signer = sessionAccountFromPrivateKey(privateKey);
  let permissions: unknown = undefined;
  try {
    permissions = JSON.parse(session.permissionsJson);
  } catch {
    permissions = undefined;
  }

  const tx = await prisma.tx.create({
    data: {
      walletId: wallet.id,
      tokenIn: opts.tokenIn,
      tokenOut: opts.tokenOut,
      amountIn: opts.amountIn.toString(),
      amountOut: built.prepared.amountOut,
      status: "submitted",
    },
  });

  try {
    const { id } = await submitSessionCalls({
      apiKey: opts.env.ALCHEMY_API_KEY,
      policyId: opts.env.ALCHEMY_GAS_POLICY_ID || undefined,
      account: wallet.address as Address,
      signer,
      calls: built.calls,
      permissions,
    });
    const status = (await waitForCall({
      apiKey: opts.env.ALCHEMY_API_KEY,
      policyId: opts.env.ALCHEMY_GAS_POLICY_ID || undefined,
      account: wallet.address as Address,
      signer,
      id,
    })) as {
      status?: string;
      receipts?: { transactionHash?: string }[];
    };
    const txHash = status.receipts?.[0]?.transactionHash ?? null;

    await prisma.tx.update({
      where: { id: tx.id },
      data: { callId: id, txHash, status: status.status ?? "confirmed" },
    });
    if (ethValue > 0n) await addSpend(wallet.id, ethValue);

    return {
      ...built,
      callId: id,
      txHash,
      status: status.status,
      remaining: remainingForUser(session, spent + ethValue),
    };
  } catch (error) {
    await prisma.tx.update({
      where: { id: tx.id },
      data: {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}

export function defaultBuyAmount(): bigint {
  return parseEther("0.01");
}
