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

    // Trigger WebAuthn authentication
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rpId,
        allowCredentials: [{
          id: base64ToArrayBuffer(data.credentialId),
          type: "public-key",
        }],
        userVerification: "required",
        timeout: 60000,
      },
    });

    if (!assertion || assertion.type !== "public-key") {
      throw new Error("Face ID authentication failed");
    }

    // Create account client for signing using stored credentials
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

    // Send the ETH transfer
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

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

