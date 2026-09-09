import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase, getMigrationStatus, openDatabaseClient } from "../src/database/database.js";
import { runMigrations } from "../src/database/migrate.js";
import { splitStatements, toPositionalPlaceholders } from "../src/database/sql.js";
import { describeConfig, loadConfig, validateConfig } from "../src/config.js";
import { createLogger, createNullLogger } from "../src/shared/logger.js";
import { describeError, notFoundError, validationError } from "../src/shared/errors.js";
import { sendError } from "../src/shared/http.js";

test("placeholder translation rewrites ? into $n without touching literals or comments", () => {
  assert.equal(
    toPositionalPlaceholders("SELECT * FROM leads WHERE organization_id = ? AND status = ?"),
    "SELECT * FROM leads WHERE organization_id = $1 AND status = $2"
  );

  // A ? inside a string literal is data, not a bind parameter.
  assert.equal(
    toPositionalPlaceholders("SELECT * FROM leads WHERE name = ? AND note = 'why? because'"),
    "SELECT * FROM leads WHERE name = $1 AND note = 'why? because'"
  );

  // '' is the escape for a quote inside a literal — the scanner must not treat
  // it as the end of the string and start counting ? again.
  assert.equal(
    toPositionalPlaceholders("SELECT ? WHERE note = 'it''s a ? mark' AND x = ?"),
    "SELECT $1 WHERE note = 'it''s a ? mark' AND x = $2"
  );

  assert.equal(toPositionalPlaceholders("SELECT ? -- trailing ? comment\n, ?"), "SELECT $1 -- trailing ? comment\n, $2");
  assert.equal(toPositionalPlaceholders('SELECT ? AS "weird?name", ?'), 'SELECT $1 AS "weird?name", $2');
});

test("statement splitting ignores semicolons inside literals and comments", () => {
  assert.deepEqual(splitStatements("CREATE TABLE a (id TEXT); CREATE TABLE b (id TEXT);"), [
    "CREATE TABLE a (id TEXT)",
    "CREATE TABLE b (id TEXT)"
  ]);
  assert.deepEqual(splitStatements("INSERT INTO a VALUES ('x;y'); SELECT 1"), ["INSERT INTO a VALUES ('x;y')", "SELECT 1"]);
  assert.deepEqual(splitStatements("SELECT 1 -- a; comment\n; SELECT 2"), ["SELECT 1 -- a; comment", "SELECT 2"]);
});

test("migrations are recorded, idempotent, and reported as up to date", async () => {
  const db = await createDatabase(":memory:");
  try {
    const status = await getMigrationStatus(db);
    assert.deepEqual(status.pending, []);
    assert.equal(status.applied.length, status.total);
    assert.ok(status.total >= 1);

    // Re-running is a no-op: nothing is applied twice, and the schema survives.
    const appliedAgain = await runMigrations(db);
    assert.deepEqual(appliedAgain, []);
    assert.equal((await getMigrationStatus(db)).applied.length, status.total);

    // The baseline schema really is present.
    await db.run("INSERT INTO organizations (id, name, created_at) VALUES (?, ?, ?)", [
      "org_x",
      "Acme",
      "2026-01-01T00:00:00.000Z"
    ]);
    assert.equal((await db.get("SELECT name FROM organizations WHERE id = ?", ["org_x"])).name, "Acme");
  } finally {
    await db.close();
  }
});

test("a database created before the migration runner adopts it without losing data", async () => {
  // Simulates the pre-migration state: tables exist, but schema_migrations does
  // not. Applying 0001 must record the version and leave existing rows intact.
  const db = await openDatabaseClient(":memory:");
  try {
    await db.exec(
      "CREATE TABLE organizations (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);"
    );
    await db.run("INSERT INTO organizations (id, name, created_at) VALUES (?, ?, ?)", [
      "org_legacy",
      "Legacy Workspace",
      "2026-01-01T00:00:00.000Z"
    ]);

    const applied = await runMigrations(db);
    assert.equal(applied.length >= 1, true);
    assert.equal((await db.get("SELECT name FROM organizations WHERE id = ?", ["org_legacy"])).name, "Legacy Workspace");
    // A table that only migration 0001 creates is now present.
    assert.deepEqual(await db.all("SELECT * FROM leads"), []);
    assert.deepEqual((await getMigrationStatus(db)).pending, []);
  } finally {
    await db.close();
  }
});

test("the database client contract is identical in shape for every driver", async () => {
  const db = await createDatabase(":memory:");
  try {
    for (const method of ["exec", "run", "get", "all", "columnExists", "transaction", "close"]) {
      assert.equal(typeof db[method], "function", `sqlite client is missing ${method}()`);
    }
    // Every read returns a promise, so repositories can await uniformly.
    assert.ok(db.get("SELECT 1 AS one") instanceof Promise);
    assert.ok(db.all("SELECT 1 AS one") instanceof Promise);
    assert.equal((await db.get("SELECT 1 AS one")).one, 1);
    assert.equal(await db.get("SELECT 1 AS one WHERE 1 = 0"), undefined);
    assert.equal(await db.columnExists("leads", "normalized_email"), true);
    assert.equal(await db.columnExists("leads", "not_a_real_column"), false);
  } finally {
    await db.close();
  }
});

test("a failing transaction rolls back every statement inside it", async () => {
  const db = await createDatabase(":memory:");
  try {
    await assert.rejects(
      () =>
        db.transaction(async (tx) => {
          await tx.run("INSERT INTO organizations (id, name, created_at) VALUES (?, ?, ?)", [
            "org_tx",
            "Rolled Back",
            "2026-01-01T00:00:00.000Z"
          ]);
          throw new Error("boom");
        }),
      /boom/
    );
    assert.equal(await db.get("SELECT * FROM organizations WHERE id = ?", ["org_tx"]), undefined);
  } finally {
    await db.close();
  }
});

test("configuration selects sqlite locally and postgres whenever DATABASE_URL is set", () => {
  const local = loadConfig({});
  assert.equal(local.env, "development");
  assert.equal(local.database.driver, "sqlite");
  assert.equal(local.security.forceSecureCookies, false);
  assert.equal(local.logging.json, false);

  const staging = loadConfig({
    NODE_ENV: "staging",
    DATABASE_URL: "postgresql://user:secret@db.example.supabase.co:5432/postgres",
    PORT: "8080"
  });
  assert.equal(staging.database.driver, "postgres");
  assert.equal(staging.database.ssl, true);
  assert.equal(staging.port, 8080);
  assert.equal(staging.security.trustProxy, true);
  assert.equal(staging.security.forceSecureCookies, true);
  assert.equal(staging.logging.json, true);
  assert.deepEqual(validateConfig(staging), []);

  // DATABASE_SSL=disable is for a plain local Postgres container.
  assert.equal(loadConfig({ DATABASE_URL: "postgres://localhost/relay", DATABASE_SSL: "disable" }).database.ssl, false);
});

test("production configuration refuses to boot on sqlite or a malformed connection string", () => {
  const sqliteInProduction = validateConfig(loadConfig({ NODE_ENV: "production" }));
  assert.equal(sqliteInProduction.length, 1);
  assert.match(sqliteInProduction[0], /DATABASE_URL is required/);

  const badUrl = validateConfig(loadConfig({ NODE_ENV: "production", DATABASE_URL: "mysql://host/db" }));
  assert.equal(badUrl.length, 1);
  assert.match(badUrl[0], /must be a postgres/);
});

test("the boot configuration summary never contains the database password", () => {
  const described = describeConfig(
    loadConfig({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://relay:sup3rs3cret@db.example.supabase.co:5432/postgres"
    })
  );
  const serialized = JSON.stringify(described);
  assert.equal(serialized.includes("sup3rs3cret"), false);
  assert.equal(serialized.includes("relay:"), false);
  assert.equal(described.database.host, "db.example.supabase.co:5432");
});

test("structured logs are single-line JSON carrying event, level and bound fields", () => {
  const lines = [];
  const logger = createLogger({
    level: "info",
    json: true,
    write: (_level, record) => lines.push(JSON.stringify(record))
  });

  logger.debug("ignored.below_threshold", {});
  logger.info("lead.created", { lead_id: "lead_1" });
  logger.child({ request_id: "req_9" }).error("http.request_failed", { error: new Error("kaboom") });

  assert.equal(lines.length, 2);
  const created = JSON.parse(lines[0]);
  assert.equal(created.event, "lead.created");
  assert.equal(created.level, "info");
  assert.equal(created.lead_id, "lead_1");
  assert.ok(created.time);

  const failed = JSON.parse(lines[1]);
  assert.equal(failed.request_id, "req_9");
  assert.equal(failed.error.message, "kaboom");
  assert.ok(failed.error.stack);
  assert.equal(
    lines.every((line) => !line.includes("\n")),
    true
  );
});

test("the null logger swallows everything so tests stay readable", () => {
  const logger = createNullLogger();
  assert.doesNotThrow(() => logger.error("anything", { error: new Error("x") }));
  assert.doesNotThrow(() => logger.child({ a: 1 }).info("nested"));
});

test("error taxonomy separates expected rejections from defects", () => {
  assert.deepEqual({ ...describeError(validationError("Email is required.")) }, {
    statusCode: 400,
    expected: true,
    code: "validation_failed",
    message: "Email is required.",
    details: null
  });
  assert.equal(describeError(notFoundError()).statusCode, 404);

  // A plain Error thrown by the pre-existing httpError() helpers still classifies.
  const legacy = new Error("Lead not found for workspace.");
  legacy.statusCode = 404;
  assert.equal(describeError(legacy).expected, true);
  assert.equal(describeError(legacy).code, "not_found");

  // An unhandled defect has no statusCode and must not be treated as expected.
  assert.equal(describeError(new Error("cannot read property of undefined")).expected, false);
  assert.equal(describeError(new Error("x")).statusCode, 500);
});

test("unexpected errors never leak their message to the client, expected ones do", () => {
  const expected = captureResponse((response) => sendError(response, validationError("Email is required.")));
  assert.equal(expected.statusCode, 400);
  assert.equal(expected.body.error, "Email is required.");
  assert.equal(expected.body.code, "validation_failed");

  const defect = new Error("SQLITE_ERROR: no such column: secret_internal_column");
  const unexpected = captureResponse((response) => sendError(response, defect, { requestId: "req_42" }));
  assert.equal(unexpected.statusCode, 500);
  assert.equal(unexpected.body.error, "Unexpected server error.");
  assert.equal(unexpected.body.request_id, "req_42");
  assert.equal(JSON.stringify(unexpected.body).includes("secret_internal_column"), false);
});

function captureResponse(run) {
  let statusCode = null;
  let body = null;
  const response = {
    writeHead(code) {
      statusCode = code;
    },
    end(payload) {
      body = JSON.parse(payload);
    }
  };
  run(response);
  return { statusCode, body };
}
