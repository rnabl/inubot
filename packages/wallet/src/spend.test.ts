import assert from "node:assert/strict";
import { test } from "node:test";
import { assertWithinDailyCap, remainingDailyCap } from "./spend.js";

test("remainingDailyCap bottoms at zero", () => {
  assert.equal(remainingDailyCap(100n, 40n), 60n);
  assert.equal(remainingDailyCap(100n, 140n), 0n);
});

test("assertWithinDailyCap blocks overspend", () => {
  assert.doesNotThrow(() => assertWithinDailyCap(100n, 40n, 50n));
  assert.throws(() => assertWithinDailyCap(100n, 40n, 70n));
});
