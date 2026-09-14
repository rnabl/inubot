-- CreateSchema
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "telegramId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "slippageBps" INTEGER NOT NULL DEFAULT 100,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");

CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "credentialId" TEXT,
    "publicKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Wallet_userId_key" ON "Wallet"("userId");
CREATE UNIQUE INDEX "Wallet_address_key" ON "Wallet"("address");

CREATE TABLE "SessionKey" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "publicAddress" TEXT NOT NULL,
    "encryptedPrivateKey" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "permissionsJson" TEXT NOT NULL,
    "dailyCapWei" TEXT NOT NULL,
    "lifetimeAllowanceWei" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SessionKey_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DailySpend" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "spentWei" TEXT NOT NULL,
    "gasWei" TEXT NOT NULL DEFAULT '0',
    CONSTRAINT "DailySpend_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DailySpend_walletId_day_key" ON "DailySpend"("walletId", "day");

CREATE TABLE "Tx" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "callId" TEXT,
    "txHash" TEXT,
    "tokenIn" TEXT NOT NULL,
    "tokenOut" TEXT NOT NULL,
    "amountIn" TEXT NOT NULL,
    "amountOut" TEXT,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Tx_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CeremonyNonce" (
    "token" TEXT NOT NULL,
    "telegramId" TEXT NOT NULL,
    "sessionPublicAddress" TEXT NOT NULL,
    "encryptedPrivateKey" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CeremonyNonce_pkey" PRIMARY KEY ("token")
);

ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SessionKey" ADD CONSTRAINT "SessionKey_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DailySpend" ADD CONSTRAINT "DailySpend_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Tx" ADD CONSTRAINT "Tx_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
