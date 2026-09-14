export type PasskeyCredential = {
  id: string;
  publicKey: `0x${string}`;
};

function bytesToHex(bytes: Uint8Array): `0x${string}` {
  return `0x${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function splitUncompressedKey(publicKey: `0x${string}`): { x: `0x${string}`; y: `0x${string}` } {
  const hex = publicKey.slice(2);
  const body = hex.startsWith("04") ? hex.slice(2) : hex;
  if (body.length !== 128) {
    throw new Error("Unexpected passkey public key length");
  }
  return {
    x: `0x${body.slice(0, 64)}`,
    y: `0x${body.slice(64)}`,
  };
}

export async function createPasskey(rpId: string, userName: string): Promise<PasskeyCredential> {
  if (!window.PublicKeyCredential) {
    throw new Error("This browser cannot create a passkey. Open the link in Safari or Chrome.");
  }

  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: "InuBot", id: rpId },
      user: {
        id: crypto.getRandomValues(new Uint8Array(16)),
        name: userName,
        displayName: "InuBot trader",
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        residentKey: "preferred",
        userVerification: "required",
      },
      timeout: 120_000,
    },
  })) as PublicKeyCredential | null;

  if (!credential) throw new Error("Passkey creation was cancelled");
  const response = credential.response as AuthenticatorAttestationResponse;
  if (typeof response.getPublicKey !== "function") {
    throw new Error("Browser did not return a passkey public key");
  }
  const publicKeyBuffer = response.getPublicKey();
  if (!publicKeyBuffer) {
    throw new Error("Browser returned null public key");
  }
  const spki = new Uint8Array(publicKeyBuffer);
  
  // Look for uncompressed EC key marker (0x04)
  const idx = spki.lastIndexOf(0x04);
  if (idx < 0) {
    console.error("SPKI bytes:", bytesToHex(spki));
    throw new Error("Could not find EC key marker (0x04) in public key. SPKI length: " + spki.length);
  }
  if (spki.length - idx < 65) {
    console.error("SPKI bytes:", bytesToHex(spki));
    throw new Error(`Public key too short after 0x04. Found at index ${idx}, remaining: ${spki.length - idx}, need: 65`);
  }
  
  return {
    id: credential.id,
    publicKey: bytesToHex(spki.slice(idx, idx + 65)),
  };
}
