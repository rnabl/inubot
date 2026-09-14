import { computeMinOut, reviewedAmountOut } from "./minOut.js";
import { RouteClient } from "./client.js";

const ROUTE_TOKEN = "0x4a72b9702f991b790788f8afa9e7112541f4e8f8";
const DUST_ETH = "100000000000000"; // 0.0001 ETH

async function main() {
  const client = new RouteClient();
  const config = await client.getConfig();
  if (config.chainId !== 4663) {
    throw new Error(`Unexpected chainId ${config.chainId}`);
  }
  if (!config.executors.route) {
    throw new Error("Missing route executor");
  }

  const tokens = await client.getTokens();
  if (!tokens.tokens.length) {
    throw new Error("Token list empty");
  }

  const lookup = await client.getTokens({ address: ROUTE_TOKEN });
  const routeToken = lookup.tokens[0];
  if (!routeToken) throw new Error("ROUTE metadata lookup failed");

  const sampleWallet = "0x0000000000000000000000000000000000000001";
  const holdings = await client.getTokens({
    wallet: sampleWallet,
    address: ROUTE_TOKEN,
  });
  if (holdings.coverage !== "listed-and-selected") {
    throw new Error(`Unexpected holdings coverage ${holdings.coverage}`);
  }

  const quote = await client.getQuote({
    tokenIn: "ETH",
    tokenOut: ROUTE_TOKEN,
    amountIn: DUST_ETH,
  });
  const minOut = computeMinOut(reviewedAmountOut(quote), 100);
  if (minOut <= 0n) throw new Error("minOut invalid");
  if (!Number.isSafeInteger(quote.expiresAt) || quote.expiresAt * 1000 < Date.now()) {
    throw new Error("Quote already expired");
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        chainId: config.chainId,
        executor: config.executors.route,
        tokenCount: tokens.tokens.length,
        routeToken: { symbol: routeToken.symbol, decimals: routeToken.decimals },
        holdings: {
          coverage: holdings.coverage,
          tokenCount: holdings.tokens.length,
          failed: holdings.failed ?? 0,
        },
        quote: {
          provider: quote.provider,
          amountOut: quote.amountOut,
          protocolFeeBps: quote.protocolFeeBps,
          minOut: minOut.toString(),
          expiresAt: quote.expiresAt,
          execution: quote.execution?.status ?? null,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
