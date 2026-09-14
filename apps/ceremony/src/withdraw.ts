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

export interface SwapBootstrap {
  telegramId: string;
  walletAddress: Address;
  rpId: string;
  alchemyApiKey: string;
  policyId: string | null;
  calls: Array<{ to: Address; data: Hex; value: bigint }>;
  chainId: number;
  credentialId: string;
  publicKey: string;
}

// Generic call execution with Face ID (B: variable isolator)
export async function executeCalls(
  walletAddress: Address,
  calls: Array<{ to: Address; data: Hex; value: bigint }>,
  credentialId: string,
  publicKey: string,
  rpId: string,
  alchemyApiKey: string,
  policyId: string | null,
): Promise<Hex> {
  const { createModularAccountV2Client } = await import("@account-kit/smart-contracts");
  
  // Create account client - this will prompt for Face ID when signing
  const client = await createModularAccountV2Client({
    mode: "webauthn",
    credential: {
      id: credentialId,
      publicKey: publicKey as Hex,
    },
    rpId,
    chain: robinhoodMainnet(alchemyApiKey),
    transport: http(`https://robinhood-mainnet.g.alchemy.com/v2/${alchemyApiKey}`),
    ...(policyId ? { policyId } : {}),
  });

  // Send calls (will prompt for Face ID)
  // Note: Account Kit v4 uses sendTransaction, not sendCalls
  // For multiple calls, we'd need to batch or send sequentially
  if (calls.length === 1) {
    const hash = await client.sendTransaction({
      to: calls[0].to,
      value: calls[0].value,
      data: calls[0].data,
    });
    return hash;
  } else {
    // TODO: Batch calls when we have multiple (approval + swap)
    throw new Error("Multiple calls not yet supported with Face ID");
  }
}

export async function executeWithdrawal(
  data: WithdrawBootstrap,
  rpId: string,
): Promise<Hex> {
  try {
    console.log("Executing withdrawal:", {
      from: data.walletAddress,
      to: data.recipient,
      amount: data.amount,
    });

    const amountWei = parseEther(data.amount);
    const hash = await executeCalls(
      data.walletAddress,
      [{
        to: data.recipient,
        value: amountWei,
        data: "0x",
      }],
      data.credentialId,
      data.publicKey,
      rpId,
      data.alchemyApiKey,
      data.policyId,
    );

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

export async function executeSwap(
  data: SwapBootstrap,
  rpId: string,
): Promise<Hex> {
  try {
    console.log("Executing swap with Face ID:", {
      from: data.walletAddress,
      calls: data.calls.length,
    });

    const hash = await executeCalls(
      data.walletAddress,
      data.calls,
      data.credentialId,
      data.publicKey,
      rpId,
      data.alchemyApiKey,
      data.policyId,
    );

    console.log("Swap transaction hash:", hash);
    return hash;
  } catch (error) {
    console.error("Swap failed:", error);
    if (error instanceof Error) {
      throw new Error(`Swap failed: ${error.message}`);
    }
    throw new Error("Swap failed");
  }
}

