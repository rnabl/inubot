import assert from "node:assert/strict";
import { test } from "node:test";
import { RouteApiError } from "./types.js";
import { RouteClient } from "./client.js";

test("retries 429 using Retry-After then succeeds", async () => {
  let calls = 0;
  const client = new RouteClient({
    baseUrl: "https://api.route.fun",
    maxRetries: 2,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ error: { code: "BUSY", message: "busy" } }), {
          status: 429,
          headers: { "retry-after": "0" },
        });
      }
      return new Response(JSON.stringify({ tokens: [] }), { status: 200 });
    },
  });

  const result = await client.getTokens();
  assert.equal(calls, 2);
  assert.deepEqual(result, { tokens: [] });
});

test("surfaces structured Route errors", async () => {
  const client = new RouteClient({
    maxRetries: 0,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          error: { code: "NO_ROUTE", message: "No route", requestId: "abc" },
        }),
        { status: 422 },
      ),
  });

  await assert.rejects(
    () => client.getQuote({ tokenIn: "ETH", tokenOut: "0x1", amountIn: "1" }),
    (err: unknown) => {
      assert.ok(err instanceof RouteApiError);
      assert.equal(err.code, "NO_ROUTE");
      assert.equal(err.requestId, "abc");
      return true;
    },
  );
});
