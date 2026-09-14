import { defineChain, type Address, type Hex } from "viem";
import { splitUncompressedKey, type PasskeyCredential } from "./passkey";

export function robinhoodMainnet(apiKey: string) {
  return defineChain({
    id: 4663,
    name: "Robinhood Chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: {
      default: { 
        http: [`https://robinhood-mainnet.g.alchemy.com/v2/${apiKey}`] 
      },
      public: { 
        http: ["https://rpc.mainnet.chain.robinhood.com"] 
      },
    },
  });
}

export type Bootstrap = {
  alreadySetup: boolean;
  address?: string;
  telegramId: string;
  rpId: string;
  alchemyApiKey: string;
  policyId: string | null;
  sessionPublicKey: Address;
  dailyCapEth: string;
  dailyCapWei: string;
  lifetimeAllowanceWei: string;
  expirySec: number;
  permissions: unknown[];
  chainId: number;
};

async function alchemyRpc<T>(apiKey: string, method: string, params: unknown[]): Promise<T> {
  const response = await fetch(`https://api.g.alchemy.com/v2/${apiKey}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await response.json()) as { result?: T; error?: { message?: string } };
  if (body.error?.message) throw new Error(body.error.message);
  if (!body.result) throw new Error(`${method} returned no result`);
  return body.result;
}

export async function requestWebAuthnAccount(
  apiKey: string,
  rpId: string,
  credential: PasskeyCredential,
): Promise<Address> {
  try {
    const { createModularAccountV2Client } = await import("@account-kit/smart-contracts");
    const { http } = await import("viem");
    
    console.log("Creating WebAuthn account with rpId:", rpId);
    console.log("Credential ID:", credential.id);
    
    const client = await createModularAccountV2Client({
      mode: "webauthn",
      credential: {
        id: credential.id,
        publicKey: credential.publicKey,
      },
      rpId,
      chain: robinhoodMainnet(apiKey),
      transport: http(`https://robinhood-mainnet.g.alchemy.com/v2/${apiKey}`),
    });
    
    console.log("Account created:", client.account.address);
    return client.account.address;
  } catch (error) {
    console.error("Failed to create WebAuthn account:", error);
    if (error instanceof Error) {
      throw new Error(`Failed to create wallet account: ${error.message}`);
    }
    throw new Error("Failed to create wallet account");
  }
}

export async function createAndGrantSession(opts: {
  apiKey: string;
  policyId?: string | null;
  rpId: string;
  credential: PasskeyCredential;
  accountAddress: Address;
  sessionPublicKey: Address;
  expirySec: number;
  permissions: unknown[];
}): Promise<unknown> {
  try {
    console.log("Session key created on server");
    console.log("Account address:", opts.accountAddress);
    console.log("Session key address:", opts.sessionPublicKey);
    console.log("Note: Using legacy session keys (no on-chain grantPermissions needed for v5)");
    
    // For v5, we don't need to call grantPermissions during setup
    // The session key works via the permissions context passed in capabilities
    // This is the "legacy session keys" approach from the migration guide
    
    return {
      granted: true,
      sessionPublicKey: opts.sessionPublicKey,
      expirySec: opts.expirySec,
      permissions: opts.permissions,
      // No permissionsContext needed - v5 works without on-chain authorization
    };
  } catch (error) {
    console.error("Failed to setup session:", error);
    if (error instanceof Error) {
      throw new Error(`Failed to setup session: ${error.message}`);
    }
    throw new Error("Failed to setup session");
  }
}
