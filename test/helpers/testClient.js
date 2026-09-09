import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createApp } from "../../src/api/app.js";
import { createDatabase } from "../../src/database/database.js";

const DEFAULT_PASSWORD = "correct-horse-battery-staple";

// Every test file in this suite used to hand-roll an identical ~30-line startClient() and call
// the now-removed unauthenticated POST /api/organizations directly. Now that every /api/ route
// requires a session, this is the one place that complexity lives: register()/login() manage a
// single active session cookie that get()/post()/put() attach automatically, and rawFetch() is
// there for the handful of tests that deliberately want to bypass that (testing the auth gate
// itself, or simulating a request with no session at all).
export async function startClient(t, databaseFile = ":memory:", { autoCleanup = true } = {}) {
  const target = await resolveDatabaseTarget(databaseFile);
  const db = await createDatabase(target);
  const server = createApp({ db });
  let stopped = false;
  let cookie = null;

  await new Promise((resolve) => server.listen(0, resolve));
  if (autoCleanup) {
    t.after(() => stop());
  }

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  async function stop() {
    if (stopped) return;
    stopped = true;
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    await db.close();
    await dropSchema(target);
  }

  function authHeaders(extra = {}) {
    return cookie ? { ...extra, cookie: `relay_session=${cookie}` } : extra;
  }

  function captureCookie(response) {
    const raw = response.headers.get("set-cookie");
    if (!raw) return;
    const match = /relay_session=([^;]+)/.exec(raw);
    if (match) {
      cookie = match[1];
    }
  }

  return {
    baseUrl,
    db,
    stop,

    // Registers a brand-new organization + owner user and makes it the active session for every
    // subsequent get()/post()/put() call. Returns { organization } — the same shape the old
    // unauthenticated POST /api/organizations returned, so existing `org.organization.id` call
    // sites throughout this test suite keep working unchanged.
    async register(organizationName, overrides = {}) {
      const uniqueSuffix = randomUUID().slice(0, 8);
      const response = await fetch(`${baseUrl}/api/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organization_name: organizationName,
          name: overrides.name || `${organizationName} Owner`,
          email: overrides.email || `owner-${uniqueSuffix}@test.relay.local`,
          password: overrides.password || DEFAULT_PASSWORD
        })
      });
      if (!response.ok) {
        assert.fail(`register failed: ${response.status} ${await response.text()}`);
      }
      captureCookie(response);
      const body = await response.json();
      return { organization: body.organization, user: body.user };
    },

    async login(email, password = DEFAULT_PASSWORD) {
      const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      if (!response.ok) {
        assert.fail(`login failed: ${response.status} ${await response.text()}`);
      }
      captureCookie(response);
      return response.json();
    },

    logout() {
      cookie = null;
    },

    // Like fetch(), but carries the active session cookie (so a test can inspect a raw
    // status/body for an authenticated-but-wrong-tenant request) without the auto-fail-on-error
    // behavior of get()/post(). For a request with NO session at all, use plain
    // fetch(`${client.baseUrl}...`) directly instead — baseUrl is exposed for exactly that.
    async rawFetch(route, options = {}) {
      return fetch(`${baseUrl}${route}`, { ...options, headers: authHeaders(options.headers) });
    },

    async get(route) {
      const response = await fetch(`${baseUrl}${route}`, { headers: authHeaders() });
      if (!response.ok) {
        assert.fail(`${response.status} ${await response.text()}`);
      }
      return response.json();
    },

    async post(route, body) {
      const response = await fetch(`${baseUrl}${route}`, {
        method: "POST",
        headers: authHeaders({ "content-type": "application/json" }),
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        assert.fail(`${response.status} ${await response.text()}`);
      }
      return response.json();
    },

    async put(route, body) {
      const response = await fetch(`${baseUrl}${route}`, {
        method: "PUT",
        headers: authHeaders({ "content-type": "application/json" }),
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        assert.fail(`${response.status} ${await response.text()}`);
      }
      return response.json();
    }
  };
}

// ---------------------------------------------------------------------------
// Running the whole suite against PostgreSQL
// ---------------------------------------------------------------------------
// By default every test runs on an in-memory SQLite database, which is what
// local development and CI use. Setting RELAY_TEST_PG=1 (together with
// TEST_DATABASE_URL) instead points every startClient() at a real PostgreSQL,
// which is how the SQL these repositories emit gets proven on the engine that
// staging and production actually run:
//
//   RELAY_TEST_PG=1 TEST_DATABASE_URL=postgresql://user:pass@host:5432/relay_test \
//     TEST_DATABASE_SSL=disable npm test
//
// Each client gets its OWN schema rather than its own database: CREATE SCHEMA is
// milliseconds where CREATE DATABASE is hundreds, and the suite starts ~50
// servers. The schema is selected by putting `search_path` in the connection
// string's `options`, so every pooled connection lands in it, and the client's
// `columnExists()` (which filters on `current_schema()`) resolves to it too.
// The schema is dropped when the client stops.
//
// Tests that call createDatabase(":memory:") directly are exercising service
// logic rather than SQL and deliberately stay on SQLite.

const POSTGRES_MODE = process.env.RELAY_TEST_PG === "1" && !!process.env.TEST_DATABASE_URL;

// TEST_DATABASE_SSL overrides, DATABASE_SSL is the fallback, so a single entry
// in .env configures the app and the tests alike. Managed Postgres is TLS-only,
// hence the default of "on".
const SSL_ENABLED = (process.env.TEST_DATABASE_SSL ?? process.env.DATABASE_SSL) !== "disable";

function postgresUrlWithSchema(schema) {
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.searchParams.set("options", `-c search_path=${schema}`);
  return url.toString();
}

async function resolveDatabaseTarget(databaseFile) {
  // An explicit config object (the postgres adapter tests) is passed through.
  if (typeof databaseFile !== "string") {
    return databaseFile;
  }
  if (!POSTGRES_MODE) {
    return databaseFile;
  }

  // A schema name has to mirror SQLite's semantics exactly, because the suite
  // relies on both:
  //   ":memory:"  -> a private database that dies with the client, so a fresh
  //                  random schema, dropped on stop().
  //   a file path -> a database that OUTLIVES the client, which is how every
  //                  "survives restart" test works: stop the server, start a
  //                  second one on the same path, and assert the data is still
  //                  there. So the schema is derived from the path and is NOT
  //                  dropped on stop() — a second client with the same path
  //                  reattaches to it.
  const ephemeral = databaseFile === ":memory:";
  const schema = ephemeral
    ? `relay_mem_${randomUUID().replaceAll("-", "")}`
    : `relay_file_${createHash("sha256").update(databaseFile).digest("hex").slice(0, 24)}`;

  const admin = await createDatabaseClient(process.env.TEST_DATABASE_URL);
  try {
    await admin.exec(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  } finally {
    await admin.close();
  }

  return {
    driver: "postgres",
    databaseUrl: postgresUrlWithSchema(schema),
    ssl: SSL_ENABLED,
    maxConnections: 4,
    __schema: ephemeral ? schema : null
  };
}

async function dropSchema(target) {
  if (!target || typeof target === "string" || !target.__schema) {
    return;
  }
  const admin = await createDatabaseClient(process.env.TEST_DATABASE_URL);
  try {
    await admin.exec(`DROP SCHEMA IF EXISTS ${target.__schema} CASCADE`);
  } finally {
    await admin.close();
  }
}

// A bare connection with no migrations run — just for CREATE/DROP SCHEMA.
async function createDatabaseClient(connectionString) {
  const { PostgresDatabaseClient } = await import("../../src/database/postgresClient.js");
  return PostgresDatabaseClient.connect({
    connectionString,
    ssl: SSL_ENABLED,
    maxConnections: 1
  });
}
