import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;

// scrypt (not bcrypt/argon2) because it's built into node:crypto — this codebase has zero npm
// dependencies by design, and scrypt is a well-regarded, memory-hard KDF suitable for password
// storage without pulling in a library for it.
export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = await scryptAsync(password, salt, KEY_LENGTH);
  return `${salt}:${derivedKey.toString("hex")}`;
}

export async function verifyPassword(password, storedHash) {
  if (typeof storedHash !== "string" || !storedHash.includes(":")) {
    return false;
  }
  const [salt, hashHex] = storedHash.split(":");
  const derivedKey = await scryptAsync(password, salt, KEY_LENGTH);
  const storedKey = Buffer.from(hashHex, "hex");
  if (storedKey.length !== derivedKey.length) {
    return false;
  }
  return timingSafeEqual(derivedKey, storedKey);
}
