# InuBot

Telegram trading bot for Robinhood Chain. Swaps go through [Route](https://route.fun). Custody is a passkey-owned Alchemy Modular Account plus a scoped server session key.

Day-to-day buy/sell stays in Telegram chat. Wallet setup is one Face ID screen in Safari (WebAuthn does not work reliably inside Telegram).

## Setup

```bash
cp .env.example .env
docker compose up -d
pnpm install
pnpm db:generate
pnpm db:push
pnpm dev
```

Create a bot with BotFather, put the token in `.env`, and set `CEREMONY_URL` / `CEREMONY_RP_ID` to a hostname you control (must be HTTPS in production).

## Commands

| Command | Purpose |
|---|---|
| `/start` | Create wallet (Safari Face ID) or show help |
| `/wallet` | Address, ETH, deposit QR |
| `/holdings` | Token balances with refresh |
| `/settings` | Adjust slippage (0.5%, 1%, 2%, 5%) |
| paste `0x…` | Resolve token, Buy/Sell |
| `/help` | Command list |

## Smoke

```bash
pnpm smoke
```

Hits live Route mainnet (`/config`, `/tokens`, `/quote`) with no API key.

A full swap still needs `.env` filled in (Telegram token, Alchemy key, `SESSION_KEY_SECRET`, Postgres), `docker compose up -d`, `pnpm db:push`, then:

1. `/start` in Telegram and complete Face ID in Safari
2. Send a little ETH to the address from `/wallet`
3. Paste a token contract and confirm a 0.01 ETH buy
4. `/holdings`

If Prisma or Route fail with `UNABLE_TO_VERIFY_LEAF_SIGNATURE` on this machine, something is intercepting TLS (common with Windows AV). Fix the trust store, or only as a last resort set `NODE_TLS_REJECT_UNAUTHORIZED=0` in your local shell.
