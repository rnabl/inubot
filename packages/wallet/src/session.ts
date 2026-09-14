import { robinhoodMainnet } from "@alchemy/common/chains";
import { createSmartWalletClient, alchemyWalletTransport } from "@alchemy/wallet-apis";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { Address, Hex } from "viem";

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

export function createSessionWalletClient(opts: AlchemyClientsOptions) {
  return createSmartWalletClient({
    transport: alchemyWalletTransport({ apiKey: opts.apiKey }),
    chain: robinhoodMainnet,
    signer: opts.signer,
    account: opts.account,
    ...(opts.policyId ? { paymaster: { policyId: opts.policyId } } : {}),
  });
}
