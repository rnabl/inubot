import assert from "node:assert/strict";
import { test } from "node:test";
import { decryptSecret, encryptSecret } from "./crypto.js";

const SECRET = "11".repeat(32);

test("encrypt then decrypt round-trips", () => {
  const blob = encryptSecret("0xdeadbeef", SECRET);
  assert.equal(decryptSecret(blob, SECRET), "0xdeadbeef");
  assert.notEqual(blob.ciphertext, "0xdeadbeef");
});

test("rejects a short secret", () => {
  assert.throws(() => encryptSecret("x", "abcd"));
});
