import { prisma } from "@inubot/db";

export async function getUserByTelegram(telegramId: string) {
  return prisma.user.findUnique({
    where: { telegramId },
    include: {
      wallet: {
        include: {
          sessionKeys: {
            where: { revokedAt: null },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      },
    },
  });
}

export async function ensureUser(telegramId: string, slippageBps: number) {
  return prisma.user.upsert({
    where: { telegramId },
    create: { telegramId, slippageBps },
    update: {},
    include: {
      wallet: {
        include: {
          sessionKeys: {
            where: { revokedAt: null },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      },
    },
  });
}

export function activeSession(user: Awaited<ReturnType<typeof getUserByTelegram>>) {
  const session = user?.wallet?.sessionKeys[0];
  if (!session) return undefined;
  if (session.expiresAt.getTime() <= Date.now()) return undefined;
  return session;
}
