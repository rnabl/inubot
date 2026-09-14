import { config } from "dotenv";
import { resolve } from "node:path";
import { serve } from "@hono/node-server";

config({ path: resolve(process.cwd(), "../../.env") });
config();

const { loadEnv } = await import("./env.js");
const { createHttpApp } = await import("./http.js");
const { createBot } = await import("./bot.js");

const env = loadEnv();
const app = createHttpApp(env);
const bot = createBot(env);

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`API listening on http://localhost:${info.port}`);
});

await bot.start({
  onStart: (info) => {
    console.log(`Bot @${info.username} started`);
  },
});
