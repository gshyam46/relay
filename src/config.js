import path from "node:path";

/**
 * Environment-driven configuration for every deployment target.
 *
 * One rule: nothing outside this module reads `process.env` for anything that
 * differs between development, staging and production. That keeps "what does
 * this deployment need configured?" answerable by reading one file, and makes
 * `validateConfig()` able to fail a bad production deploy at boot instead of on
 * the first request that happens to need the missing value.
 */

const DEVELOPMENT = "development";
const STAGING = "staging";
const PRODUCTION = "production";
const TEST = "test";

const LOG_LEVELS = ["debug", "info", "warn", "error"];

export function loadConfig(env = process.env) {
  const nodeEnv = normalizeEnv(env.NODE_ENV);
  const databaseUrl = trimmed(env.DATABASE_URL);
  const isProductionLike = nodeEnv === PRODUCTION || nodeEnv === STAGING;

  return {
    env: nodeEnv,
    isProductionLike,
    port: Number(env.PORT || 3000),

    database: databaseUrl
      ? {
          driver: "postgres",
          databaseUrl,
          // Managed Postgres (Supabase, Render, Neon) is TLS-only. `disable` is
          // for a plain local container.
          ssl: trimmed(env.DATABASE_SSL) !== "disable",
          maxConnections: positiveInt(env.DATABASE_MAX_CONNECTIONS, 10),
          connectionTimeoutMillis: positiveInt(env.DATABASE_CONNECTION_TIMEOUT_MS, 10000)
        }
      : {
          driver: "sqlite",
          databaseFile: trimmed(env.DATABASE_FILE) || path.join("data", "app.db")
        },

    logging: {
      level: LOG_LEVELS.includes(trimmed(env.LOG_LEVEL)) ? trimmed(env.LOG_LEVEL) : isProductionLike ? "info" : "debug",
      // Structured single-line JSON in deployed environments (so Render's log
      // drain can parse it); human-readable text locally.
      json: trimmed(env.LOG_FORMAT) ? trimmed(env.LOG_FORMAT) === "json" : isProductionLike
    },

    security: {
      // Behind Render/any reverse proxy the socket is plain HTTP; the original
      // scheme only survives in X-Forwarded-Proto. Trusting that header is what
      // lets session cookies be marked Secure in staging and production.
      trustProxy: boolean(env.TRUST_PROXY, isProductionLike),
      // Forces the Secure attribute on session cookies regardless of how the
      // request arrived. On by default anywhere that is not local development.
      forceSecureCookies: boolean(env.FORCE_SECURE_COOKIES, isProductionLike)
    },

    worker: {
      enabled: boolean(env.WORKER_ENABLED, true),
      intervalMs: positiveInt(env.WORKER_INTERVAL_MS, 5000)
    },

    llm: {
      provider: trimmed(env.LLM_PROVIDER) || null,
      model: trimmed(env.LLM_MODEL) || null
    }
  };
}

/**
 * Fails fast on a deployment that is missing something it cannot run correctly
 * without. Returns the list of problems rather than throwing, so the caller can
 * log all of them at once instead of one per restart.
 */
export function validateConfig(config) {
  const problems = [];

  if (!Number.isInteger(config.port) || config.port <= 0) {
    problems.push("PORT must be a positive integer.");
  }

  if (config.isProductionLike) {
    if (config.database.driver !== "postgres") {
      problems.push(
        `DATABASE_URL is required when NODE_ENV=${config.env}. SQLite has no managed backups and cannot be shared across instances.`
      );
    }
    if (config.database.driver === "postgres" && !/^postgres(ql)?:\/\//.test(config.database.databaseUrl)) {
      problems.push("DATABASE_URL must be a postgres:// or postgresql:// connection string.");
    }
  }

  return problems;
}

/**
 * Redacted view of the configuration, safe to log at boot. Secrets are reported
 * as present/absent only — a connection string carries the database password.
 */
export function describeConfig(config) {
  return {
    env: config.env,
    port: config.port,
    database: {
      driver: config.database.driver,
      ...(config.database.driver === "postgres"
        ? { host: hostOf(config.database.databaseUrl), ssl: config.database.ssl, max_connections: config.database.maxConnections }
        : { file: config.database.databaseFile })
    },
    log_level: config.logging.level,
    log_format: config.logging.json ? "json" : "text",
    worker_enabled: config.worker.enabled,
    llm_provider: config.llm.provider || "none"
  };
}

function hostOf(connectionString) {
  try {
    return new URL(connectionString).host;
  } catch {
    return "invalid-url";
  }
}

function normalizeEnv(value) {
  const normalized = trimmed(value)?.toLowerCase();
  if (normalized === PRODUCTION || normalized === "prod") return PRODUCTION;
  if (normalized === STAGING || normalized === "stage") return STAGING;
  if (normalized === TEST) return TEST;
  return DEVELOPMENT;
}

function trimmed(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function boolean(value, fallback) {
  const normalized = trimmed(value)?.toLowerCase();
  if (normalized === undefined) return fallback;
  return normalized === "1" || normalized === "true" || normalized === "yes";
}
