FROM node:22-slim

WORKDIR /app

# Install pnpm and openssl (needed by Prisma)
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm

# Copy everything first (simpler approach)
COPY . .

# Install dependencies (skip postinstall scripts, we'll run generate manually)
RUN pnpm install --frozen-lockfile --ignore-scripts

# Generate Prisma client
RUN pnpm db:generate

# Expose port
EXPOSE 3000

# Start command
CMD ["sh", "-c", "pnpm db:migrate && pnpm --filter @inubot/bot start"]
