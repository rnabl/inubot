import { robinhoodMainnet } from "@inubot/shared";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { http, type Address, type Hex } from "viem";

export type SessionKeyPair = {
  privateKey: Hex;
  account: PrivateKeyAccount;
};

export function generateSessionKey(): SessionKeyPair {
  const privateKey = generatePrivateKey();
  return { privateKey, account: privateKeyToAccount(privateKey) };
}

export function sessionAccountFromPrivateKey(privateKey: Hex): PrivateKeyAccount {
  return privateKeyToAccount(privateKey);
}

export type AlchemyClientsOptions = {
  apiKey: string;
  policyId?: string;
  account: Address;
  signer: PrivateKeyAccount;
};

export async function createSessionWalletClient(opts: AlchemyClientsOptions) {
  const { createWalletClient } = await import("@alchemy/wallet-apis");
  
  // Create wallet client v5 style with session key
  return createWalletClient({
    transport: http(`https://robinhood-mainnet.g.alchemy.com/v2/${opts.apiKey}`),
    chain: robinhoodMainnet,
    account: opts.signer, // Session key is the signer
    // For swaps, the session key sends from the smart account address
    // This is handled via the "from" parameter in sendCalls
  });
}
