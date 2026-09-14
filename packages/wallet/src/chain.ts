import { createPublicClient, http, type PublicClient } from "viem";
import { robinhoodMainnet } from "@inubot/shared";

export function createRobinhoodPublicClient(rpcUrl?: string): PublicClient {
  return createPublicClient({
    chain: robinhoodMainnet,
    transport: http(rpcUrl ?? robinhoodMainnet.rpcUrls.default.http[0]),
  });
}
