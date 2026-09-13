import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt), KEY_LENGTH = 64;
const OPTIONS = Object.freeze({ N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 });
export const MAX_PASSWORD_BYTES = 1024;
// This public dummy hash is never an account. Unknown identities still perform one KDF.
export const DUMMY_PASSWORD_HASH = "d7234cd1c601faba09ee5f7d07c09124:c1e8cd21f9c29bc56d6bea93c83bb4b2c100f13f8954d6ef3b1587e460d6f327ff5e9f641fc48cb945daa59fb10b8f8d3f2dc589efb806d80a5d92a35445ef71";

export async function hashPassword(password) {
  requirePassword(password);
  const salt = randomBytes(16).toString("hex");
  const key = await scryptAsync(password, salt, KEY_LENGTH, OPTIONS);
  return salt + ":" + key.toString("hex");
}
export async function verifyPassword(password, storedHash) {
  requirePassword(password);
  const valid = typeof storedHash === "string" && storedHash.length === 161 && /^[a-f0-9]{32}:[a-f0-9]{128}$/.test(storedHash);
  const [salt, hashHex] = (valid ? storedHash : DUMMY_PASSWORD_HASH).split(":");
  const key = await scryptAsync(password, salt, KEY_LENGTH, OPTIONS);
  const matches = timingSafeEqual(key, Buffer.from(hashHex, "hex"));
  return valid && matches;
}
function requirePassword(value) {
  if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value, "utf8") > MAX_PASSWORD_BYTES) {
    throw Object.assign(new Error("Password exceeds the supported input bounds."), { statusCode: 400, code: "AUTH_INPUT_INVALID" });
  }
}
