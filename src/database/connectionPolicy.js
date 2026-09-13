import { X509Certificate } from "node:crypto";
import { isIP } from "node:net";
import { checkServerIdentity } from "node:tls";

export const DATABASE_LIMITS = Object.freeze({
  runtime: Object.freeze({ statement: 15000, statementMax: 30000, query: 20000, queryMax: 60000 }),
  migration: Object.freeze({ statement: 120000, statementMax: 300000, query: 130000, queryMax: 330000 })
});
const ENVIRONMENTS = new Set(["development", "test", "staging", "production"]);
const TEST_RUN = /^[a-f0-9]{24}$/;
const TEST_SCHEMA = /^relay_test_[a-f0-9]{24}_(mem|file|adapter)_[a-f0-9]{16}$/;

export function databasePolicyError(code = "DATABASE_CONFIGURATION_INVALID") {
  const messages = {
    DATABASE_CONFIGURATION_INVALID: "Database configuration is invalid; connection details are redacted.",
    DATABASE_URL_INVALID: "Database URL must explicitly identify a PostgreSQL host, database, user and password; URL overrides are refused.",
    DATABASE_TLS_REQUIRED: "Staging and production require verified PostgreSQL TLS.",
    DATABASE_CA_INVALID: "Database TLS CA must be a valid bounded PEM certificate bundle; its value is redacted.",
    DATABASE_TEST_SCOPE_INVALID: "Database test options require a valid owned disposable schema."
  };
  return Object.assign(new Error(messages[code] || messages.DATABASE_CONFIGURATION_INVALID), { code });
}

export function parsePostgresUrl(value) {
  let url;
  if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value, "utf8") > 16384) throw databasePolicyError("DATABASE_URL_INVALID");
  try { url = new URL(value); } catch { throw databasePolicyError("DATABASE_URL_INVALID"); }
  if (!/^postgres(ql)?:$/.test(url.protocol) || !url.hostname || !url.username || !url.password
    || !url.pathname || url.pathname === "/" || url.search || url.hash || value.includes("?") || value.includes("#")) {
    throw databasePolicyError("DATABASE_URL_INVALID");
  }
  let user, password, database;
  try { user = decodeURIComponent(url.username); password = decodeURIComponent(url.password); database = decodeURIComponent(url.pathname.slice(1)); }
  catch { throw databasePolicyError("DATABASE_URL_INVALID"); }
  const host = url.hostname.replace(/^\[|\]$/g, ""), port = Number(url.port || 5432);
  if (!user || !password || !database || [host, user, database].some((field) => /[\u0000-\u0020\u007f]/.test(field))
    || password.includes("\u0000") || user.length > 256 || database.length > 256 || password.length > 4096
    || !Number.isInteger(port) || port < 1 || port > 65535) throw databasePolicyError("DATABASE_URL_INVALID");
  return { host, port, user, password, database };
}

export function validateCa(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value, "utf8") > 65536) throw databasePolicyError("DATABASE_CA_INVALID");
  const certificates = value.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
  if (!certificates?.length || certificates.length > 16 || value.replace(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g, "").trim()) {
    throw databasePolicyError("DATABASE_CA_INVALID");
  }
  try { for (const certificate of certificates) { if (!new X509Certificate(certificate).ca) throw new Error(); } }
  catch { throw databasePolicyError("DATABASE_CA_INVALID"); }
  return certificates.join("\n");
}

function integer(value, fallback, maximum) {
  const chosen = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(chosen) || chosen < 1 || chosen > maximum) throw databasePolicyError();
  return chosen;
}

/** Pure validated pool options. Never forward a connection URL or arbitrary pg options. */
export function buildPostgresOptions(config) {
  if (!config || typeof config !== "object") throw databasePolicyError();
  const environment = config.environment ?? "development";
  if (!ENVIRONMENTS.has(environment)) throw databasePolicyError();
  const purpose = config.purpose ?? "runtime", profile = DATABASE_LIMITS[purpose];
  if (!Object.hasOwn(DATABASE_LIMITS, purpose)) throw databasePolicyError();
  const selected = parsePostgresUrl(config.databaseUrl ?? config.connectionString);
  const ssl = config.ssl === undefined ? true : config.ssl;
  if (typeof ssl !== "boolean") throw databasePolicyError();
  if (["staging", "production"].includes(environment) && !ssl) throw databasePolicyError("DATABASE_TLS_REQUIRED");
  const ca = validateCa(config.sslCa);
  if (!ssl && ca !== null) throw databasePolicyError();
  const max = integer(config.maxConnections, purpose === "migration" ? 1 : 10, 100);
  const acquisition = integer(config.connectionTimeoutMillis, 10000, 30000);
  const statement = integer(config.statementTimeoutMillis, profile.statement, profile.statementMax);
  const query = integer(config.queryTimeoutMillis, profile.query, profile.queryMax);
  const idleTransaction = integer(config.idleInTransactionSessionTimeoutMillis, 15000, 60000);
  if (query <= statement) throw databasePolicyError();
  if (config.readOnlyTransaction !== undefined && typeof config.readOnlyTransaction !== "boolean") throw databasePolicyError();
  const hasTestOptions = config.testSchema !== undefined || config.testRunId !== undefined || config.readOnlyTransaction === true;
  if (hasTestOptions && (environment !== "test" || !TEST_RUN.test(config.testRunId || "")
    || !TEST_SCHEMA.test(config.testSchema || "") || !config.testSchema.startsWith("relay_test_" + config.testRunId + "_"))) {
    throw databasePolicyError("DATABASE_TEST_SCOPE_INVALID");
  }
  // A nonempty options string prevents unvalidated PGOPTIONS fallback. Every
  // parameter below is constructed from bounded numbers or the owned schema.
  let options = "-c statement_timeout=" + statement + " -c lock_timeout=5000 -c idle_in_transaction_session_timeout=" + idleTransaction;
  if (hasTestOptions) options += " -c search_path=" + config.testSchema;
  if (config.readOnlyTransaction) options += " -c default_transaction_read_only=on";
  return {
    ...selected,
    ssl: ssl ? { rejectUnauthorized: true, minVersion: "TLSv1.2", ...(ca ? { ca } : {}),
      ...(isIP(selected.host) ? {} : { servername: selected.host }),
      checkServerIdentity: (_name, certificate) => checkServerIdentity(selected.host, certificate) } : false,
    // Explicit selected credentials, options and client settings prevent pg's
    // PG* environment fallbacks from changing connection identity or bounds.
    options, application_name: "ai-lead-intelligence-" + purpose,
    fallback_application_name: "ai-lead-intelligence-" + purpose,
    client_encoding: "UTF8", sslnegotiation: "postgres",
    max, connectionTimeoutMillis: acquisition, idleTimeoutMillis: 10000,
    statement_timeout: statement, query_timeout: query, lock_timeout: 5000,
    idle_in_transaction_session_timeout: idleTransaction,
    keepAlive: true, keepAliveInitialDelayMillis: 10000
  };
}
