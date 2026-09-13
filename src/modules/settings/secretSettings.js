/**
 * Provider credentials must not travel to the browser.
 *
 * Settings are read back by the Settings page so it can show what is configured.
 * Before this, that response contained the raw provider API key, so every
 * settings page load put a live credential into the browser — reachable by any
 * XSS, any browser extension, any screen share, and any client-side error
 * reporter. The key is only ever needed server-side, when actually calling the
 * provider.
 *
 * So: reads return a mask, and writes treat the mask as "leave it alone". That
 * second half matters — without it, saving the form after loading it would
 * overwrite the real key with the mask.
 */

/** Setting keys whose values are credentials. */
const SECRET_KEYS = new Set(["bot_token", "api_key", "api_secret", "auth_token", "password", "client_secret", "private_key"]);

/**
 * What a configured secret reads back as. A fixed sentinel rather than a
 * length-preserving mask, so the response leaks nothing about the value.
 */
export const MASKED_SECRET = "********";

export function isSecretKey(key) {
  return SECRET_KEYS.has(key);
}

/**
 * Replaces every configured secret with the mask, and adds a `<key>_configured`
 * boolean so the UI can still distinguish "set" from "not set".
 */
export function maskSecrets(settingsByCategory) {
  const masked = {};
  for (const [category, values] of Object.entries(settingsByCategory || {})) {
    masked[category] = {};
    for (const [key, value] of Object.entries(values || {})) {
      if (isSecretKey(key)) {
        const configured = typeof value === "string" ? value.trim().length > 0 : value != null;
        masked[category][key] = configured ? MASKED_SECRET : "";
        masked[category][`${key}_configured`] = configured;
        continue;
      }
      masked[category][key] = value;
    }
  }
  return masked;
}

/**
 * Prepares an incoming settings update for storage.
 *
 * - A secret submitted as the mask means "unchanged" and is dropped, so the
 *   stored credential survives a save that did not retype it.
 * - A secret submitted as an empty string is a deliberate clear and is kept.
 * - The `<key>_configured` hints produced by `maskSecrets` are read-only and are
 *   never written back.
 */
export function stripUnchangedSecrets(values) {
  const result = {};
  for (const [key, value] of Object.entries(values || {})) {
    if (key.endsWith("_configured")) {
      continue;
    }
    if (isSecretKey(key) && value === MASKED_SECRET) {
      continue;
    }
    result[key] = value;
  }
  return result;
}
