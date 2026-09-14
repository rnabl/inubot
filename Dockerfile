FROM node:22-slim

WORKDIR /app

# Install pnpm and openssl (needed by Prisma)
RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm

# Copy everything
COPY . .

# Install dependencies (postinstall will run prisma generate)
RUN pnpm install --frozen-lockfile

# Build ceremony app
RUN pnpm --filter @inubot/ceremony build

# Expose port
EXPOSE 3000

# Start command
CMD ["sh", "-c", "pnpm --filter @inubot/db exec prisma migrate deploy && pnpm --filter @inubot/bot start"]
