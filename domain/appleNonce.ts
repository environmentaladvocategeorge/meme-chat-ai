import * as Crypto from "expo-crypto";

export async function randomNonce(byteLength = 32) {
  const bytes = await Crypto.getRandomBytesAsync(byteLength);
  let hex = "";

  for (let i = 0; i < bytes.length; i += 1) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }

  return hex;
}

export async function sha256(value: string) {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value);
}
