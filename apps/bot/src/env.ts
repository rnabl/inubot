import { z } from "zod";

const schema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_BOT_USERNAME: z.string().default("inubot"),
  CEREMONY_URL: z.string().url(),
  CEREMONY_RP_ID: z.string().min(1),
  CEREMONY_SECRET: z.string().min(16),
  ALCHEMY_API_KEY: z.string().min(1),
  ALCHEMY_GAS_POLICY_ID: z.string().optional().default(""),
  SESSION_KEY_SECRET: z.string().regex(/^[0-9a-fA-F]{64}$/),
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().default(3000),
  PUBLIC_API_URL: z.string().url().default("http://localhost:3000"),
  DEFAULT_DAILY_CAP_ETH: z.string().default("0.25"),
  DEFAULT_SLIPPAGE_BPS: z.coerce.number().int().min(1).max(5000).default(100),
  ROUTE_API_BASE: z.string().url().default("https://api.route.fun"),
  RPC_URL: z.string().optional().default(""),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return schema.parse(source);
}
