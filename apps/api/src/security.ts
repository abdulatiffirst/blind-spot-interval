import {
  createHash,
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
export const random = () => randomBytes(32).toString("base64url");
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
function key() {
  const value = process.env.TOKEN_ENCRYPTION_KEY;
  if (!value || !/^[0-9a-f]{64}$/i.test(value))
    throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes in hex");
  return Buffer.from(value, "hex");
}
export function encrypt(value: unknown) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(), iv);
  return Buffer.concat([
    iv,
    cipher.update(JSON.stringify(value)),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString("base64url");
}
export function decrypt(value: string) {
  const b = Buffer.from(value, "base64url"),
    cipher = createDecipheriv("aes-256-gcm", key(), b.subarray(0, 12));
  cipher.setAuthTag(b.subarray(-16));
  return JSON.parse(
    Buffer.concat([
      cipher.update(b.subarray(12, -16)),
      cipher.final(),
    ]).toString(),
  );
}
export const appOrigin = () =>
  process.env.APP_ORIGIN ?? "http://localhost:5173";
export const apiOrigin = () =>
  process.env.API_ORIGIN ?? "http://localhost:3001";
