import assert from "node:assert/strict";
import { test } from "node:test";
import { computeMinOut, reviewedAmountOut } from "./minOut.js";

test("computeMinOut applies 1% slippage", () => {
  assert.equal(computeMinOut(1_000_000n, 100), 990_000n);
});

test("computeMinOut rejects empty output", () => {
  assert.throws(() => computeMinOut(0n, 100));
});

test("reviewedAmountOut prefers simulated execution", () => {
  assert.equal(
    reviewedAmountOut({
      amountOut: "100",
      execution: { status: "simulated", amountOut: "90" },
    }),
    90n,
  );
});

test("reviewedAmountOut falls back when simulation unavailable", () => {
  assert.equal(
    reviewedAmountOut({
      amountOut: "100",
      execution: { status: "unavailable" },
    }),
    100n,
  );
});
