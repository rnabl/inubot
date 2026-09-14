import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";

export function parseSecretKey(secretHex: string): Buffer {
  const key = Buffer.from(secretHex, "hex");
  if (key.length !== 32) {
    throw new Error("SESSION_KEY_SECRET must be 32 bytes encoded as 64 hex characters");
  }
  return key;
}

export type EncryptedBlob = {
  ciphertext: string;
  iv: string;
  tag: string;
};

export function encryptSecret(plaintext: string, secretHex: string): EncryptedBlob {
  const key = parseSecretKey(secretHex);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptSecret(blob: EncryptedBlob, secretHex: string): string {
  const key = parseSecretKey(secretHex);
  const decipher = createDecipheriv(ALGO, key, Buffer.from(blob.iv, "base64"));
  decipher.setAuthTag(Buffer.from(blob.tag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(blob.ciphertext, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
