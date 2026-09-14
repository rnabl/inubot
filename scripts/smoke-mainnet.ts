/**
 * Live Route smoke + optional env checks for the full swap path.
 * Full UserOp submission still needs a funded passkey account.
 *
 *   pnpm smoke
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const result = spawnSync("pnpm", ["--filter", "@inubot/route", "smoke"], {
  cwd: root,
  stdio: "inherit",
  shell: true,
});
process.exit(result.status ?? 1);
