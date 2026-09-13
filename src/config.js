import path from "node:path";
import { buildPostgresOptions, DATABASE_LIMITS, parsePostgresUrl } from "./database/connectionPolicy.js";

const LOCAL_AUTH_SECRET = "local-only-auth-admission-key-never-use-in-production";
const ENVIRONMENTS = new Set(["development", "test", "staging", "production"]);
const LOG_LEVELS = ["debug", "info", "warn", "error"];

/** All deployment environment parsing is centralized here; invalid explicit values remain errors. */
export function loadConfig(env = process.env) {
  const problems = [];
  const problem = (scope, message) => problems.push({ scope, message });
  const nodeEnv = normalizeEnv(env.NODE_ENV);
  if (!ENVIRONMENTS.has(nodeEnv)) problem("database", "NODE_ENV must be development, test, staging or production.");
  const isProductionLike = !["development", "test"].includes(nodeEnv);
  const globalTlsDisabled = trimmed(env.NODE_TLS_REJECT_UNAUTHORIZED) === "0";
  if (isProductionLike && globalTlsDisabled) problem("database", "NODE_TLS_REJECT_UNAUTHORIZED=0 is forbidden in staging and production.");
  const port = integer(env.PORT, 3000, 65535, "PORT", "runtime", problem);
  const databaseUrl = trimmed(env.DATABASE_URL);
  const pgEnvironmentPresent = Object.keys(env).some((key) => /^PG/i.test(key) && env[key] !== undefined);
  if (databaseUrl && pgEnvironmentPresent) problem("database", "PG environment overrides are refused; use DATABASE configuration fields.");
  const requestedControls = boolean(env.ENABLE_TEST_CONTROLS, false, "ENABLE_TEST_CONTROLS", "runtime", problem);
  const testControlsEnabled = !isProductionLike && requestedControls;
  const developerToolsEnabled = !isProductionLike && boolean(env.ENABLE_DEVELOPER_TOOLS, false, "ENABLE_DEVELOPER_TOOLS", "runtime", problem);
  const isolatedRequested = boolean(env.ISOLATED_E2E_HARNESS, false, "ISOLATED_E2E_HARNESS", "runtime", problem);
  const hasProviderConfiguration = Object.entries(env).some(([key, value]) =>
    value && /^(LLM_|GROQ_|OPENAI_|OPENROUTER_|OLLAMA_|SENDGRID_|RESEND_|TWILIO_|WHATSAPP_|N8N_)/i.test(key));
  const isolatedE2eHarness = nodeEnv === "test" && testControlsEnabled && isolatedRequested && !databaseUrl
    && trimmed(env.DATABASE_FILE) === ":memory:" && !hasProviderConfiguration;
  const sslValue = env.DATABASE_SSL;
  let ssl = true;
  if (sslValue !== undefined) {
    const selected = trimmed(sslValue)?.toLowerCase();
    if (!["enable", "disable"].includes(selected)) problem("database", "DATABASE_SSL must be enable or disable.");
    ssl = selected !== "disable";
  }
  const profile = DATABASE_LIMITS.runtime;
  const database = databaseUrl ? {
    driver: "postgres", environment: nodeEnv, purpose: "runtime", databaseUrl, ssl,
    sslCa: env.DATABASE_SSL_CA === undefined ? null : env.DATABASE_SSL_CA,
    maxConnections: integer(env.DATABASE_MAX_CONNECTIONS, 10, 100, "DATABASE_MAX_CONNECTIONS", "database", problem),
    connectionTimeoutMillis: integer(env.DATABASE_CONNECTION_TIMEOUT_MS, 10000, 30000, "DATABASE_CONNECTION_TIMEOUT_MS", "database", problem),
    statementTimeoutMillis: integer(env.DATABASE_STATEMENT_TIMEOUT_MS, profile.statement, profile.statementMax, "DATABASE_STATEMENT_TIMEOUT_MS", "database", problem),
    queryTimeoutMillis: integer(env.DATABASE_QUERY_TIMEOUT_MS, profile.query, profile.queryMax, "DATABASE_QUERY_TIMEOUT_MS", "database", problem),
    idleInTransactionSessionTimeoutMillis: integer(env.DATABASE_IDLE_TRANSACTION_TIMEOUT_MS, 15000, 60000, "DATABASE_IDLE_TRANSACTION_TIMEOUT_MS", "database", problem)
  } : { driver: "sqlite", databaseFile: trimmed(env.DATABASE_FILE) || path.join("data", "app.db") };
  if (env.DATABASE_URL !== undefined && !databaseUrl) problem("database", "DATABASE_URL must be a nonempty PostgreSQL connection URL when supplied.");
  const verificationMailbox = (key) => {
    if (env[key] === undefined) return null;
    const value = trimmed(env[key]);
    if (!value || value.length > 254 || !/^[^\s@<>,;:"()[\]\\]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$/.test(value) || value.split("@")[0].length > 64) { problem("runtime", key + " must be one exact authorized email address."); return null; }
    return value.toLowerCase();
  };
  const controlledRecipients = { delivery: verificationMailbox("EMAIL_VERIFICATION_DELIVERY_MAILBOX"), failure: verificationMailbox("EMAIL_VERIFICATION_FAILURE_MAILBOX") };
  if (controlledRecipients.delivery && controlledRecipients.delivery === controlledRecipients.failure) problem("runtime", "Email verification delivery and failure mailboxes must be distinct.");
  const origin = publicOrigin(env.PUBLIC_APP_ORIGIN, isProductionLike, port, problem);
  const secret = env.AUTH_RATE_LIMIT_SECRET === undefined ? (isProductionLike ? null : LOCAL_AUTH_SECRET) : env.AUTH_RATE_LIMIT_SECRET;
  if (typeof secret !== "string" || Buffer.byteLength(secret, "utf8") < 32 || Buffer.byteLength(secret, "utf8") > 4096
    || !secret.trim() || (isProductionLike && secret === LOCAL_AUTH_SECRET)) {
    problem("runtime", "AUTH_RATE_LIMIT_SECRET must be an explicit non-production-default secret of 32 to 4096 bytes when deployed.");
  }
  const logLevel = trimmed(env.LOG_LEVEL), logFormat = trimmed(env.LOG_FORMAT);
  if (env.LOG_LEVEL !== undefined && !LOG_LEVELS.includes(logLevel)) problem("runtime", "LOG_LEVEL must be debug, info, warn or error.");
  if (env.LOG_FORMAT !== undefined && !["json", "text"].includes(logFormat)) problem("runtime", "LOG_FORMAT must be json or text.");
  return {
    env: nodeEnv, isProductionLike, port, database,
    logging: { level: LOG_LEVELS.includes(logLevel) ? logLevel : isProductionLike ? "info" : "debug", json: logFormat ? logFormat === "json" : isProductionLike },
    security: {
      trustProxy: boolean(env.TRUST_PROXY, isProductionLike, "TRUST_PROXY", "runtime", problem),
      forceSecureCookies: boolean(env.FORCE_SECURE_COOKIES, isProductionLike, "FORCE_SECURE_COOKIES", "runtime", problem),
      testControlsEnabled, developerToolsEnabled, isolatedE2eHarness, publicAppOrigin: origin
    },
    emailVerification: { controlledRecipients },
    auth: { rateLimitSecret: secret, maxConcurrentHashes: 2 },
    http: { headerBytes: 16384, headerTimeout: 10000, requestTimeout: 30000, bodyTimeout: 10000, keepAlive: 5000, maxInFlight: 64 },
    outbound: { enabled: boolean(env.OUTBOUND_DISPATCH_ENABLED, !isProductionLike, "OUTBOUND_DISPATCH_ENABLED", "runtime", problem) },
    worker: { enabled: boolean(env.WORKER_ENABLED, true, "WORKER_ENABLED", "runtime", problem),
      intervalMs: integer(env.WORKER_INTERVAL_MS, 5000, 300000, "WORKER_INTERVAL_MS", "runtime", problem) },
    llm: { provider: trimmed(env.LLM_PROVIDER) || null, model: trimmed(env.LLM_MODEL) || null },
    _pgEnvironmentPresent: pgEnvironmentPresent,
    _globalTlsDisabled: globalTlsDisabled,
    _validationProblems: problems
  };
}

/** Deployed migration jobs must explicitly select their privileged target. */
export function loadMigrationConfig(env = process.env) {
  const nodeEnv = normalizeEnv(env.NODE_ENV), deployed = ["production", "staging"].includes(nodeEnv);
  const migrationUrl = trimmed(env.MIGRATION_DATABASE_URL);
  if (deployed && !migrationUrl) throw Object.assign(new Error("A separate migration database URL is required."), { code: "MIGRATION_DATABASE_REQUIRED" });
  if (env.MIGRATION_DATABASE_URL !== undefined) {
    try { parsePostgresUrl(migrationUrl); } catch { throw Object.assign(new Error("The migration database URL is invalid (redacted)."), { code: "MIGRATION_DATABASE_INVALID" }); }
  }
  const config = loadConfig({ ...env,
    ...(migrationUrl ? { DATABASE_URL: migrationUrl } : {}),
    DATABASE_SSL: env.MIGRATION_DATABASE_SSL ?? env.DATABASE_SSL,
    DATABASE_SSL_CA: env.MIGRATION_DATABASE_SSL_CA ?? env.DATABASE_SSL_CA,
    DATABASE_MAX_CONNECTIONS: env.MIGRATION_DATABASE_MAX_CONNECTIONS ?? "1",
    DATABASE_CONNECTION_TIMEOUT_MS: env.MIGRATION_DATABASE_CONNECTION_TIMEOUT_MS ?? env.DATABASE_CONNECTION_TIMEOUT_MS,
    // Migration limits are parsed separately against their larger bounded profile.
    DATABASE_STATEMENT_TIMEOUT_MS: undefined, DATABASE_QUERY_TIMEOUT_MS: undefined,
    DATABASE_IDLE_TRANSACTION_TIMEOUT_MS: env.MIGRATION_DATABASE_IDLE_TRANSACTION_TIMEOUT_MS ?? env.DATABASE_IDLE_TRANSACTION_TIMEOUT_MS
  });
  if (config.database.driver === "postgres") {
    const problem = (scope, message) => config._validationProblems.push({ scope, message });
    const profile = DATABASE_LIMITS.migration;
    config.database.purpose = "migration";
    config.database.statementTimeoutMillis = integer(env.MIGRATION_DATABASE_STATEMENT_TIMEOUT_MS, profile.statement, profile.statementMax,
      "MIGRATION_DATABASE_STATEMENT_TIMEOUT_MS", "database", problem);
    config.database.queryTimeoutMillis = integer(env.MIGRATION_DATABASE_QUERY_TIMEOUT_MS, profile.query, profile.queryMax,
      "MIGRATION_DATABASE_QUERY_TIMEOUT_MS", "database", problem);
  }
  return config;
}

export function validateConfig(config, { scope = "runtime" } = {}) {
  if (!["runtime", "database"].includes(scope)) throw new TypeError("Configuration validation scope is invalid.");
  const problems = (config._validationProblems || []).filter((item) => scope === "runtime" || item.scope === "database").map((item) => item.message);
  if (!ENVIRONMENTS.has(config.env)) problems.push("NODE_ENV must be development, test, staging or production.");
  const deployed = ["staging", "production"].includes(config.env);
  if (deployed && config.database?.driver !== "postgres") problems.push("DATABASE_URL is required when NODE_ENV=" + config.env + ". SQLite has no managed backups and cannot be shared across instances.");
  if (config.database?.driver === "postgres") {
    try { buildPostgresOptions({ ...config.database, environment: config.env }); } catch (error) { problems.push(error.message); }
  } else if (config.database?.driver !== "sqlite") problems.push("Database driver must be sqlite or postgres.");
  if (scope === "runtime") {
    if (!Number.isSafeInteger(config.port) || config.port < 1 || config.port > 65535) problems.push("PORT must be an integer from 1 to 65535.");
    if (deployed && config.security?.forceSecureCookies !== true) problems.push("Staging and production require secure session cookies.");
    publicOrigin(config.security?.publicAppOrigin, deployed, config.port, (_scope, message) => problems.push(message));
    const secret = config.auth?.rateLimitSecret;
    if (typeof secret !== "string" || Buffer.byteLength(secret, "utf8") < 32 || Buffer.byteLength(secret, "utf8") > 4096
      || !secret.trim() || (deployed && secret === LOCAL_AUTH_SECRET)) problems.push("AUTH_RATE_LIMIT_SECRET must be an explicit non-production-default secret of 32 to 4096 bytes when deployed.");
  }
  return [...new Set(problems)];
}

/** This view intentionally omits URLs, user/password, auth secret and CA material. */
export function describeConfig(config) {
  return {
    env: config.env, port: config.port,
    database: { driver: config.database.driver, ...(config.database.driver === "postgres" ? {
      host: hostOf(config.database.databaseUrl), ssl: config.database.ssl, verified_tls: config.database.ssl === true,
      custom_ca_present: Boolean(config.database.sslCa), max_connections: config.database.maxConnections,
      statement_timeout_ms: config.database.statementTimeoutMillis, query_timeout_ms: config.database.queryTimeoutMillis
    } : { file: config.database.databaseFile }) },
    log_level: config.logging.level, log_format: config.logging.json ? "json" : "text",
    worker_enabled: config.worker.enabled, test_controls_enabled: config.security.testControlsEnabled,
    outbound_dispatch_enabled: config.outbound.enabled, public_app_origin: config.security.publicAppOrigin,
    llm_provider: config.llm.provider || "none"
  };
}
function hostOf(value) { try { return new URL(value).host; } catch { return "invalid-url"; } }
function normalizeEnv(value) {
  if (value === undefined) return "development";
  const normalized = trimmed(value)?.toLowerCase();
  if (normalized === "prod") return "production";
  if (normalized === "stage") return "staging";
  return ENVIRONMENTS.has(normalized) ? normalized : "invalid";
}
function trimmed(value) { return typeof value === "string" && value.trim() ? value.trim() : undefined; }
function integer(value, fallback, maximum, name, scope, problem) {
  if (value === undefined) return fallback;
  const parsed = typeof value === "string" && /^[0-9]+$/.test(value.trim()) ? Number(value.trim()) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    problem(scope, name + " must be an integer from 1 to " + maximum + ".");
    return NaN;
  }
  return parsed;
}
function boolean(value, fallback, name, scope, problem) {
  if (value === undefined) return fallback;
  const selected = trimmed(value)?.toLowerCase();
  if (["true", "1", "yes"].includes(selected)) return true;
  if (["false", "0", "no"].includes(selected)) return false;
  problem(scope, name + " must be true/false, 1/0 or yes/no.");
  return false;
}
function publicOrigin(value, deployed, port, problem) {
  if (value === undefined || value === null) {
    if (!deployed) return "http://localhost:" + port;
    problem("runtime", "PUBLIC_APP_ORIGIN must be an explicit HTTPS origin when deployed.");
    return null;
  }
  let url;
  try { if (typeof value === "string" && value.trim()) url = new URL(value.trim()); } catch { /* Fixed safe diagnostic below. */ }
  if (!url || !["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password
    || url.pathname !== "/" || url.search || url.hash || value.includes("?") || value.includes("#") || (deployed && url.protocol !== "https:")) {
    problem("runtime", "PUBLIC_APP_ORIGIN must be a canonical HTTP(S) origin without credentials, path, query or fragment; deployed origins require HTTPS.");
    return null;
  }
  return url.origin;
}
