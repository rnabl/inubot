import { ROBINHOOD_CHAIN_ID, ROUTE_API_BASE, toRouteToken } from "@inubot/shared";
import { RouteApiError, type RouteConfig, type RouteErrorBody, type RoutePreparedSwap, type RouteQuote, type RouteTokenList, type QuoteParams, type PrepareSwapParams } from "./types.js";

export type RouteClientOptions = {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  return undefined;
}

export class RouteClient {
  readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(opts: RouteClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? ROUTE_API_BASE).replace(/\/$/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    this.maxRetries = opts.maxRetries ?? 3;
  }

  async getConfig(): Promise<RouteConfig> {
    return this.request<RouteConfig>("/api/v2/config");
  }

  async getTokens(params: { address?: string; wallet?: string } = {}): Promise<RouteTokenList> {
    const query = new URLSearchParams();
    if (params.address) query.set("address", toRouteToken(params.address));
    if (params.wallet) query.set("wallet", params.wallet);
    const suffix = query.size ? `?${query}` : "";
    return this.request<RouteTokenList>(`/api/v2/tokens${suffix}`);
  }

  async getQuote(params: QuoteParams): Promise<RouteQuote> {
    const query = new URLSearchParams({
      chainId: String(ROBINHOOD_CHAIN_ID),
      tokenIn: toRouteToken(params.tokenIn),
      tokenOut: toRouteToken(params.tokenOut),
      amountIn: params.amountIn,
    });
    if (params.provider) query.set("provider", params.provider);
    return this.request<RouteQuote>(`/api/v2/quote?${query}`);
  }

  async prepareSwap(params: PrepareSwapParams): Promise<RoutePreparedSwap> {
    return this.request<RoutePreparedSwap>("/api/v2/swap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chainId: ROBINHOOD_CHAIN_ID,
        tokenIn: toRouteToken(params.tokenIn),
        tokenOut: toRouteToken(params.tokenOut),
        amountIn: params.amountIn,
        amountOutMinimum: params.amountOutMinimum,
        recipient: params.recipient,
        deadline: params.deadline,
        expiresAt: params.expiresAt,
        branches: params.branches,
        provider: params.provider,
        ...(params.variant ? { variant: params.variant } : {}),
        ...(params.txOrigin ? { txOrigin: params.txOrigin } : {}),
      }),
    });
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let attempt = 0;
    let lastError: unknown;

    while (attempt <= this.maxRetries) {
      try {
        const response = await this.fetchImpl(new URL(path, `${this.baseUrl}/`), {
          ...init,
          redirect: "error",
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
        const text = await response.text();
        let body: unknown = undefined;
        if (text) {
          try {
            body = JSON.parse(text) as unknown;
          } catch {
            body = undefined;
          }
        }

        if (response.status === 429 || response.status === 503) {
          const errBody = (body ?? {}) as RouteErrorBody;
          const error = new RouteApiError(
            errBody.error?.message ?? `Route ${response.status}`,
            {
              status: response.status,
              code: errBody.error?.code,
              retryAfter,
              requestId: errBody.error?.requestId,
            },
          );
          if (attempt < this.maxRetries) {
            const waitMs = (retryAfter ?? 2) * 1000;
            await sleep(waitMs);
            attempt += 1;
            lastError = error;
            continue;
          }
          throw error;
        }

        if (!response.ok) {
          const errBody = (body ?? {}) as RouteErrorBody;
          throw new RouteApiError(
            errBody.error?.message ?? `Route HTTP ${response.status}`,
            {
              status: response.status,
              code: errBody.error?.code,
              retryAfter,
              requestId: errBody.error?.requestId,
            },
          );
        }

        return body as T;
      } catch (error) {
        lastError = error;
        if (error instanceof RouteApiError) throw error;
        if (attempt >= this.maxRetries) throw error;
        await sleep(500 * 2 ** attempt);
        attempt += 1;
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Route request failed");
  }
}

export const routeClient = new RouteClient();
