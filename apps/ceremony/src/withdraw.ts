import { type Address, type Hex, parseEther } from "viem";
import { http } from "viem";
import { robinhoodMainnet } from "./alchemy";

export interface WithdrawBootstrap {
  telegramId: string;
  walletAddress: Address;
  rpId: string;
  alchemyApiKey: string;
  policyId: string | null;
  recipient: Address;
  amount: string;
  chainId: number;
  credentialId: string;
  publicKey: string;
}

export async function executeWithdrawal(
  data: WithdrawBootstrap,
  rpId: string,
): Promise<Hex> {
  try {
    const { createModularAccountV2Client } = await import("@account-kit/smart-contracts");
    
    console.log("Executing withdrawal:", {
      from: data.walletAddress,
      to: data.recipient,
      amount: data.amount,
    });

    // Create account client - this will prompt for Face ID when signing
    const client = await createModularAccountV2Client({
      mode: "webauthn",
      credential: {
        id: data.credentialId,
        publicKey: data.publicKey as Hex,
      },
      rpId,
      chain: robinhoodMainnet(data.alchemyApiKey),
      transport: http(`https://robinhood-mainnet.g.alchemy.com/v2/${data.alchemyApiKey}`),
      ...(data.policyId ? { policyId: data.policyId } : {}),
    });

    // Send the ETH transfer (will prompt for Face ID)
    const amountWei = parseEther(data.amount);
    const hash = await client.sendTransaction({
      to: data.recipient,
      value: amountWei,
      data: "0x",
    });

    console.log("Withdrawal transaction hash:", hash);
    return hash;
  } catch (error) {
    console.error("Withdrawal failed:", error);
    if (error instanceof Error) {
      throw new Error(`Withdrawal failed: ${error.message}`);
    }
    throw new Error("Withdrawal failed");
  }
}

