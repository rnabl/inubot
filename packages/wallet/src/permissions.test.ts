import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeFunctionData, getAddress } from "viem";
import { ERC20_ABI } from "@inubot/shared";
import { assertCallsAreRouteScoped, decodeApproveSpender } from "./permissions.js";
import type { RouteConfig } from "@inubot/route";

const EXECUTOR = getAddress("0x1111111111111111111111111111111111111111");
const OTHER = getAddress("0x2222222222222222222222222222222222222222");

const config = {
  executors: { route: EXECUTOR },
  tokenOutputExecutors: { route: EXECUTOR },
} as unknown as RouteConfig;

test("decodeApproveSpender reads the spender word", () => {
  const data = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: "approve",
    args: [EXECUTOR, 1n],
  });
  assert.equal(decodeApproveSpender(data), EXECUTOR);
});

test("allows Route executor calls and Route-scoped approve", () => {
  const approve = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: "approve",
    args: [EXECUTOR, 1n],
  });
  assert.doesNotThrow(() =>
    assertCallsAreRouteScoped(config, [
      { to: EXECUTOR, data: "0x" },
      { to: OTHER, data: approve },
    ]),
  );
});

test("rejects approve to a non-Route spender", () => {
  const approve = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: "approve",
    args: [OTHER, 1n],
  });
  assert.throws(() => assertCallsAreRouteScoped(config, [{ to: OTHER, data: approve }]));
});
