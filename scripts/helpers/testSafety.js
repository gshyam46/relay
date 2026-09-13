import { createHash, randomUUID } from "node:crypto";

// Test children inherit operating-system essentials only. In particular no
// DATABASE_URL, provider key, proxy, NODE_OPTIONS, or .env preload is forwarded.
const OS_KEYS = new Set([
  "PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "TMPDIR",
  "HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA",
  "LANG", "LC_ALL", "TERM", "TZ"
]);
const PROVIDER_KEY = /^(LLM_|GROQ_|OPENAI_|OPENROUTER_|OLLAMA_|SENDGRID_|RESEND_|TWILIO_|WHATSAPP_|N8N_)/i;
const RUN_ID = /^[a-f0-9]{24}$/;
const SCHEMA = /^relay_test_[a-f0-9]{24}_(mem|file|adapter)_[a-f0-9]{16}$/;

export function safeTestEnvironment(env = process.env) {
  const safe = {};
  for (const [key, value] of Object.entries(env)) {
    if (OS_KEYS.has(key.toUpperCase()) && value !== undefined) safe[key] = value;
  }
  return {
    ...safe,
    NODE_ENV: "test",
    DATABASE_FILE: ":memory:",
    ENABLE_TEST_CONTROLS: "true",
    WORKER_ENABLED: "false",
    LOG_LEVEL: "error",
    LOG_FORMAT: "text"
  };
}

export function assertNoLiveProviders(env = process.env) {
  if (Object.entries(env).some(([key, value]) => value && PROVIDER_KEY.test(key))) {
    throw new Error("Test harness refused inherited provider configuration. Use npm test or a clean sandbox environment.");
  }
}

export function e2eEnvironment(env = process.env) {
  assertNoLiveProviders(env);
  if (/^(prod|production|stage|staging)$/i.test(env.NODE_ENV || "") || env.DATABASE_URL) {
    throw new Error("E2E refused inherited production mode or DATABASE_URL. Only disposable in-memory SQLite is supported.");
  }
  if ([env.DATABASE_FILE, env.E2E_DATABASE_FILE].some((value) => value && value !== ":memory:")) {
    throw new Error("E2E refused a file database override. Its database must be disposable :memory:.");
  }
  const port = Number(env.E2E_PORT || 3100);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("E2E_PORT must be between 1 and 65535.");
  return { ...safeTestEnvironment(env), PORT: String(port), LOG_LEVEL: "info", ISOLATED_E2E_HARNESS: "1" };
}

function parsePostgresUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("TEST_DATABASE_URL must be a valid PostgreSQL URL (value redacted)."); }
  if (!/^postgres(ql)?:$/.test(url.protocol) || !url.hostname || !url.pathname || url.pathname === "/") {
    throw new Error("TEST_DATABASE_URL must identify a PostgreSQL host and database (value redacted).");
  }
  // The runner owns search_path and TLS selection; URL overrides can change
  // effective libpq targets or route schema-scoped work into another database.
  if ([...url.searchParams.keys()].length > 0 || url.hash) {
    throw new Error("TEST_DATABASE_URL query/fragment overrides are refused. Use TEST_DATABASE_SSL for TLS mode.");
  }
  return url;
}

function databaseIdentity(url) {
  return [url.hostname.toLowerCase(), url.port || "5432", decodeURIComponent(url.pathname)].join("|");
}

export function postgresTestTarget(env = process.env) {
  if (!env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is required. DATABASE_URL is never a test fallback.");
  if (env.TEST_DATABASE_DISPOSABLE !== "1") {
    throw new Error("Set TEST_DATABASE_DISPOSABLE=1 only for a dedicated disposable test database.");
  }
  const url = parsePostgresUrl(env.TEST_DATABASE_URL);
  if (env.DATABASE_URL) {
    let application;
    try { application = new URL(env.DATABASE_URL); } catch { throw new Error("Inherited DATABASE_URL is invalid; remove it before PostgreSQL tests."); }
    if (databaseIdentity(application) === databaseIdentity(url)) {
      throw new Error("PostgreSQL tests refused the configured application database. Supply a separate disposable target.");
    }
  }
  if (env.TEST_DATABASE_SSL && !["enable", "disable"].includes(env.TEST_DATABASE_SSL)) {
    throw new Error("TEST_DATABASE_SSL must be enable or disable.");
  }
  return {
    connectionString: url.toString(),
    ssl: env.TEST_DATABASE_SSL !== "disable",
    // JSON escaping prevents control characters in a target name forging logs.
    description: JSON.stringify({ host: url.hostname, port: url.port || "5432", database: decodeURIComponent(url.pathname.slice(1)) })
  };
}

export function newTestRunId() {
  return randomUUID().replaceAll("-", "").slice(0, 24);
}

export function schemaPrefix(runId) {
  if (!RUN_ID.test(runId || "")) throw new Error("PostgreSQL tests require a valid runner-owned namespace.");
  return "relay_test_" + runId + "_";
}

export function schemaFor(runId, kind, identity = randomUUID()) {
  if (!["mem", "file", "adapter"].includes(kind)) throw new Error("Unsupported test schema kind.");
  return schemaPrefix(runId) + kind + "_" + createHash("sha256").update(identity).digest("hex").slice(0, 16);
}

export function isOwnedSchema(schema, runId) {
  return typeof schema === "string" && SCHEMA.test(schema) && schema.startsWith(schemaPrefix(runId));
}

export function postgresTestContext(env = process.env) {
  if (env.RELAY_TEST_PG !== "1") return null;
  const target = postgresTestTarget(env);
  schemaPrefix(env.RELAY_TEST_RUN_ID);
  return { ...target, runId: env.RELAY_TEST_RUN_ID };
}

export function schemaDatabaseConfig(context, schema) {
  if (!isOwnedSchema(schema, context.runId)) throw new Error("Refused database schema outside this test run.");
  return { driver: "postgres", environment: "test", databaseUrl: context.connectionString, ssl: context.ssl,
    maxConnections: 4, testSchema: schema, testRunId: context.runId };
}

export async function connectTestAdmin(context) {
  const { PostgresDatabaseClient } = await import("../../src/database/postgresClient.js");
  return PostgresDatabaseClient.connect({ connectionString: context.connectionString, ssl: context.ssl, maxConnections: 1, environment: "test" });
}

export async function cleanupRunSchemas(context, connect = connectTestAdmin) {
  const prefix = schemaPrefix(context.runId);
  const db = await connect(context);
  let count = 0;
  try {
    const rows = await db.all(
      "SELECT schema_name FROM information_schema.schemata WHERE left(schema_name, ?) = ?",
      [prefix.length, prefix]
    );
    for (const { schema_name: schema } of rows) {
      if (!isOwnedSchema(schema, context.runId)) continue;
      await db.exec('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE');
      count += 1;
    }
  } finally {
    await db.close();
  }
  return count;
}

export function workflowVerificationTarget(value = "http://127.0.0.1:3100") {
  let url;
  try { url = new URL(value); } catch { throw new Error("Workflow verification refused an invalid target URL (redacted)."); }
  if (url.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Workflow verification requires a loopback HTTP origin for the isolated E2E harness. Remote, credentialed and path targets are refused.");
  }
  return url.origin;
}

export async function verifyE2eHandshake(base, fetchImpl = fetch) {
  // Revalidate here as well so direct helper callers cannot skip target policy.
  const origin = workflowVerificationTarget(base);
  let response;
  let body;
  try {
    response = await fetchImpl(origin + "/api/health", { redirect: "error", signal: AbortSignal.timeout(5000) });
    body = await response.json();
  } catch {
    throw new Error("Workflow verification could not verify the isolated E2E server. No workflow writes were attempted.");
  }
  const harness = body?.test_harness;
  if (!response.ok || harness?.kind !== "isolated-e2e" || harness.database !== "sqlite-memory" || harness.providers !== "disabled") {
    throw new Error("Workflow verification refused a server without the isolated E2E capability. Start npm run dev:e2e first; no workflow writes were attempted.");
  }
  return origin;
}
