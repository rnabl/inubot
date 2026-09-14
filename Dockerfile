FROM node:22-slim

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/bot/package.json ./apps/bot/
COPY apps/ceremony/package.json ./apps/ceremony/
COPY packages/db/package.json ./packages/db/
COPY packages/route/package.json ./packages/route/
COPY packages/wallet/package.json ./packages/wallet/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Generate Prisma client
RUN pnpm db:generate

# Expose port
EXPOSE 3000

# Start command
CMD ["sh", "-c", "pnpm db:migrate && pnpm --filter @inubot/bot start"]
