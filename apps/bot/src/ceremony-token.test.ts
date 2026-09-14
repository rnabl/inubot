import assert from "node:assert/strict";
import { test } from "node:test";
import { signCeremonyToken, verifyCeremonyToken } from "./ceremony-token.js";

test("signs and verifies a ceremony token", () => {
  const token = signCeremonyToken("42", "super-secret-value");
  assert.deepEqual(verifyCeremonyToken(token, "super-secret-value").telegramId, "42");
});

test("rejects a tampered token", () => {
  const token = signCeremonyToken("42", "super-secret-value");
  assert.throws(() => verifyCeremonyToken(`${token}x`, "super-secret-value"));
});
