import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../../src/api/app.js";
import { createDatabase } from "../../src/database/database.js";
import { loadConfig } from "../../src/config.js";
import { assertNoLiveProviders, connectTestAdmin, isOwnedSchema, postgresTestContext, schemaDatabaseConfig, schemaFor } from "../../scripts/helpers/testSafety.js";

const DEFAULT_PASSWORD = "correct-horse-battery-staple";

// Every test file in this suite used to hand-roll an identical ~30-line startClient() and call
// the now-removed unauthenticated POST /api/organizations directly. Now that every /api/ route
// requires a session, this is the one place that complexity lives: register()/login() manage a
// single active session cookie that get()/post()/put() attach automatically, and rawFetch() is
// there for the handful of tests that deliberately want to bypass that (testing the auth gate
// itself, or simulating a request with no session at all).
export async function startClient(t, databaseFile = ":memory:", { autoCleanup = true, config: appConfig = null } = {}) {
  assertNoLiveProviders();
  const target = await resolveDatabaseTarget(databaseFile);
  const db = await createDatabase(target);
  const config = appConfig || loadConfig({ NODE_ENV: "test", ENABLE_TEST_CONTROLS: "true", WORKER_ENABLED: "false" });
  const server = createApp({ db, config });
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
    services: server.services,
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

    // These helpers explicitly perform the preview/decision protocol. Callers
    // must opt into simulated review; post/execute never approves silently.
    async review(actionId) {
      return this.get("/api/actions/" + actionId + "/approval");
    },

    async approve(actionId, editedPayload = null) {
      let reviewed = await this.review(actionId);
      if (editedPayload) {
        reviewed = await this.post("/api/actions/" + actionId + "/approval/preview", {
          expected_revision_id: reviewed.prepared_revision.id, edited_payload: editedPayload
        });
      }
      return this.post("/api/actions/" + actionId + "/approval/approve", {
        expected_revision_id: reviewed.prepared_revision.id
      });
    },

    async reject(actionId, reviewerNote = null) {
      const reviewed = await this.review(actionId);
      return this.post("/api/actions/" + actionId + "/approval/reject", {
        expected_revision_id: reviewed.prepared_revision.id, reviewer_note: reviewerNote
      });
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

// PostgreSQL test contexts are issued by scripts/run-postgres-tests.js only.
// Memory schemas die with the client; file schemas survive a simulated restart
// inside this run, but never overlap a concurrent or later run using that path.
const POSTGRES = postgresTestContext();

async function resolveDatabaseTarget(databaseFile) {
  if (typeof databaseFile !== "string") {
    if (databaseFile?.driver === "postgres") {
      if (!POSTGRES) throw new Error("PostgreSQL fixtures require npm run test:pg and its owned namespace.");
      let url;
      try { url = new URL(databaseFile.databaseUrl); } catch { throw new Error("Invalid test fixture database URL (redacted)."); }
      const schema = url.searchParams.get("options")?.replace(/^-c search_path=/, "");
      const expected = schemaDatabaseConfig(POSTGRES, schema);
      if (databaseFile.databaseUrl !== expected.databaseUrl) throw new Error("Refused PostgreSQL fixture outside this run's target.");
      return expected;
    }
    return databaseFile;
  }
  if (!POSTGRES) return databaseFile;

  const ephemeral = databaseFile === ":memory:";
  const schema = ephemeral
    ? schemaFor(POSTGRES.runId, "mem")
    : schemaFor(POSTGRES.runId, "file", databaseFile);
  const admin = await connectTestAdmin(POSTGRES);
  try {
    await admin.exec('CREATE SCHEMA IF NOT EXISTS "' + schema + '"');
  } finally {
    await admin.close();
  }
  return { ...schemaDatabaseConfig(POSTGRES, schema), __schema: ephemeral ? schema : null };
}

async function dropSchema(target) {
  if (!target || typeof target === "string" || !target.__schema) return;
  if (!POSTGRES || !isOwnedSchema(target.__schema, POSTGRES.runId)) throw new Error("Refused cleanup outside this test run.");
  const admin = await connectTestAdmin(POSTGRES);
  try {
    await admin.exec('DROP SCHEMA IF EXISTS "' + target.__schema + '" CASCADE');
  } finally {
    await admin.close();
  }
}
