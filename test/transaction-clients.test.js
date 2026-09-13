import { EventEmitter } from "node:events";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { setImmediate as turn } from "node:timers/promises";
import { SqliteDatabaseClient } from "../src/database/sqliteClient.js";
import { PostgresDatabaseClient } from "../src/database/postgresClient.js";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function sqliteFixture(t) {
  const db = new SqliteDatabaseClient();
  t.after(() => db.close());
  return db;
}

function tempFile(t) {
  const directory = mkdtempSync(path.join(tmpdir(), "lead-tx-client-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, "fixture.sqlite");
}

function pgFixture(t, options = {}) {
  const calls = [];
  const connections = [];
  const pool = {
    async query(sql, params) {
      calls.push({ source: "pool", sql, params });
      return options.query ? options.query(sql, params, "pool") : { rows: [{ value: 1 }], rowCount: 1 };
    },
    async connect() {
      const id = connections.length + 1;
      const connection = {
        async query(sql, params) {
          calls.push({ source: id, sql, params });
          return options.query ? options.query(sql, params, id) : { rows: [{ value: 1 }], rowCount: 1 };
        },
        release(error) {
          calls.push({ source: id, release: true, error });
        }
      };
      connections.push(connection);
      return connection;
    },
    async end() { calls.push({ end: true }); }
  };
  const db = new PostgresDatabaseClient(pool);
  t.after(() => db.close());
  return { db, calls, connections };
}

test("sqlite: a unit of work commits both participating writes and returns its result", async (t) => {
  const db = sqliteFixture(t);
  await db.exec("CREATE TABLE records (id TEXT PRIMARY KEY); CREATE TABLE events (record_id TEXT);");
  const result = await db.transaction(async (tx) => {
    assert.notEqual(tx, db);
    assert.equal(tx.transactionBound, true);
    await tx.run("INSERT INTO records VALUES (?)", ["r1"]);
    await tx.run("INSERT INTO events VALUES (?)", ["r1"]);
    assert.equal(await tx.columnExists("records", "id"), true);
    return { id: "r1" };
  });
  assert.deepEqual(result, { id: "r1" });
  assert.deepEqual((await db.all("SELECT * FROM events")).map((row) => ({ ...row })), [{ record_id: "r1" }]);
  assert.deepEqual((await db.all("SELECT * FROM records")).map((row) => ({ ...row })), [{ id: "r1" }]);
});

test("sqlite: a later repository failure rolls back every write", async (t) => {
  const db = sqliteFixture(t);
  await db.exec("CREATE TABLE records (id TEXT PRIMARY KEY); CREATE TABLE events (record_id TEXT);");
  await assert.rejects(db.transaction(async (tx) => {
    await tx.run("INSERT INTO records VALUES (?)", ["r1"]);
    await tx.run("INSERT INTO events VALUES (?)", ["r1"]);
    throw new Error("audit failed");
  }), /audit failed/);
  assert.deepEqual(await db.all("SELECT * FROM records"), []);
  assert.deepEqual(await db.all("SELECT * FROM events"), []);
});

test("sqlite: catching a statement failure does not commit a partial unit of work", async (t) => {
  const db = sqliteFixture(t);
  await db.exec("CREATE TABLE records (id TEXT PRIMARY KEY)");
  await assert.rejects(db.transaction(async (tx) => {
    await tx.run("INSERT INTO records VALUES (?)", ["r1"]);
    await assert.rejects(tx.run("INSERT INTO records VALUES (?)", ["r1"]), /UNIQUE/);
  }), /UNIQUE/);
  assert.deepEqual(await db.all("SELECT * FROM records"), []);
});

test("sqlite: an unrelated write cannot join and be rolled back by another caller's transaction", async (t) => {
  const db = sqliteFixture(t);
  await db.exec("CREATE TABLE records (id TEXT PRIMARY KEY)");
  const entered = deferred();
  const proceed = deferred();
  const transaction = db.transaction(async (tx) => {
    await tx.run("INSERT INTO records VALUES (?)", ["rolled-back"]);
    entered.resolve();
    await proceed.promise;
    throw new Error("rollback owner only");
  });
  const rejected = assert.rejects(transaction, /rollback owner only/);
  await entered.promise;
  let outsideFinished = false;
  const outside = db.run("INSERT INTO records VALUES (?)", ["independent"])
    .then(() => { outsideFinished = true; });
  let readFinished = false;
  const read = db.all("SELECT * FROM records").then((rows) => {
    readFinished = true;
    return rows;
  });
  await turn();
  assert.equal(outsideFinished, false);
  assert.equal(readFinished, false);
  proceed.resolve();
  await rejected;
  await outside;
  assert.deepEqual((await read).map((row) => ({ ...row })), [{ id: "independent" }]);
});

test("sqlite: concurrent transactions on one client wait and execute their callbacks once", async (t) => {
  const db = sqliteFixture(t);
  await db.exec("CREATE TABLE records (id TEXT PRIMARY KEY)");
  const entered = deferred();
  const proceed = deferred();
  const order = [];
  const first = db.transaction(async (tx) => {
    order.push("first");
    entered.resolve();
    await proceed.promise;
    await tx.run("INSERT INTO records VALUES (?)", ["first"]);
  });
  await entered.promise;
  const second = db.transaction(async (tx) => {
    order.push("second");
    await tx.run("INSERT INTO records VALUES (?)", ["second"]);
  });
  await turn();
  assert.deepEqual(order, ["first"]);
  proceed.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(order, ["first", "second"]);
  assert.equal((await db.all("SELECT * FROM records")).length, 2);
});

for (const driver of ["sqlite", "postgres"]) {
  test(driver + ": root escape, nesting and scoped close reject without opening another transaction", async (t) => {
    const db = driver === "sqlite" ? sqliteFixture(t) : pgFixture(t).db;
    await db.transaction(async (tx) => {
      for (const call of [
        () => db.exec("SELECT 1"),
        () => db.run("SELECT 1"),
        () => db.get("SELECT 1"),
        () => db.all("SELECT 1"),
        () => db.columnExists("records", "id"),
        () => db.transaction(async () => {}),
        () => db.close()
      ]) {
        await assert.rejects(call, /transaction-scoped client/);
      }
      await assert.rejects(tx.transaction(async () => {}), /Nested transactions/);
      await assert.rejects(tx.close(), /cannot close/);
      assert.ok(await tx.get("SELECT 1 AS value"));
    });
  });

  test(driver + ": scoped handles reject after both commit and rollback", async (t) => {
    const db = driver === "sqlite" ? sqliteFixture(t) : pgFixture(t).db;
    for (const rollback of [false, true]) {
      let captured;
      const transaction = db.transaction(async (tx) => {
        captured = tx;
        if (rollback) throw new Error("rollback");
      });
      if (rollback) await assert.rejects(transaction, /rollback/);
      else await transaction;
      for (const call of [
        () => captured.exec("SELECT 1"),
        () => captured.run("SELECT 1"),
        () => captured.get("SELECT 1"),
        () => captured.all("SELECT 1"),
        () => captured.columnExists("records", "id"),
        () => captured.transaction(async () => {}),
        () => captured.close()
      ]) {
        await assert.rejects(call, /Transaction-scoped client is closed/);
      }
    }
  });

  test(driver + ": detached async work cannot use a completed transaction or escape to the root", async (t) => {
    const db = driver === "sqlite" ? sqliteFixture(t) : pgFixture(t).db;
    const proceed = deferred();
    let escaped;
    await db.transaction(async (tx) => {
      escaped = (async () => {
        await proceed.promise;
        await assert.rejects(tx.get("SELECT 1"), /Transaction-scoped client is closed/);
        await assert.rejects(db.get("SELECT 1"), /outer database access is forbidden/);
      })();
    });
    proceed.resolve();
    await escaped;
  });

  test(driver + ": a scoped handle cannot be borrowed by an unrelated async caller", async (t) => {
    const db = driver === "sqlite" ? sqliteFixture(t) : pgFixture(t).db;
    const entered = deferred();
    const proceed = deferred();
    let captured;
    const transaction = db.transaction(async (tx) => {
      captured = tx;
      entered.resolve();
      await proceed.promise;
    });
    await entered.promise;
    await assert.rejects(captured.get("SELECT 1"), /outside its owning transaction context/);
    proceed.resolve();
    await transaction;
  });

  test(driver + ": close drains accepted work and refuses new operations", async (t) => {
    const db = driver === "sqlite" ? sqliteFixture(t) : pgFixture(t).db;
    const entered = deferred();
    const proceed = deferred();
    const transaction = db.transaction(async (tx) => {
      entered.resolve();
      await proceed.promise;
      return tx.get("SELECT 1 AS value");
    });
    await entered.promise;
    let closed = false;
    const closing = db.close().then(() => { closed = true; });
    await assert.rejects(db.get("SELECT 1"), /Database client is closed/);
    await assert.rejects(db.transaction(async () => {}), /Database client is closed/);
    await turn();
    assert.equal(closed, false);
    proceed.resolve();
    assert.ok(await transaction);
    await closing;
    await db.close();
    await assert.rejects(db.exec("SELECT 1"), /Database client is closed/);
  });
}

test("sqlite: separate connections wait asynchronously for the write reservation without replaying work", async (t) => {
  const file = tempFile(t);
  const firstDb = new SqliteDatabaseClient(file);
  const secondDb = new SqliteDatabaseClient(file);
  try {
    await firstDb.exec("CREATE TABLE records (id TEXT PRIMARY KEY)");
    const entered = deferred();
    const proceed = deferred();
    let firstCalls = 0;
    let secondCalls = 0;
    const first = firstDb.transaction(async (tx) => {
      firstCalls += 1;
      entered.resolve();
      await proceed.promise;
      await tx.run("INSERT INTO records VALUES (?)", ["first"]);
    });
    await entered.promise;
    const second = secondDb.transaction(async (tx) => {
      secondCalls += 1;
      await tx.run("INSERT INTO records VALUES (?)", ["second"]);
    }, { lockTimeoutMs: 1000 });
    await turn();
    assert.equal(secondCalls, 0);
    proceed.resolve();
    await Promise.all([first, second]);
    assert.equal(firstCalls, 1);
    assert.equal(secondCalls, 1);
    assert.equal((await secondDb.all("SELECT * FROM records")).length, 2);
  } finally {
    await firstDb.close();
    await secondDb.close();
  }
});

test("sqlite: lock acquisition timeout never invokes domain work and leaves the client reusable", async (t) => {
  const file = tempFile(t);
  const firstDb = new SqliteDatabaseClient(file);
  const secondDb = new SqliteDatabaseClient(file);
  try {
    await firstDb.exec("CREATE TABLE records (id TEXT PRIMARY KEY)");
    const entered = deferred();
    const proceed = deferred();
    let calls = 0;
    const first = firstDb.transaction(async () => {
      entered.resolve();
      await proceed.promise;
    });
    await entered.promise;
    await assert.rejects(secondDb.transaction(async () => { calls += 1; }, { lockTimeoutMs: 0 }), /locked|busy/i);
    assert.equal(calls, 0);
    proceed.resolve();
    await first;
    await secondDb.transaction(async (tx) => { await tx.run("INSERT INTO records VALUES (?)", ["after"]); });
    assert.deepEqual((await secondDb.all("SELECT * FROM records")).map((row) => ({ ...row })), [{ id: "after" }]);
  } finally {
    await firstDb.close();
    await secondDb.close();
  }
});

test("sqlite: read-only inspection reads existing records, rejects writes and never creates a missing file", async (t) => {
  const file = tempFile(t);
  const writable = new SqliteDatabaseClient(file);
  await writable.exec("CREATE TABLE records (id TEXT PRIMARY KEY); INSERT INTO records VALUES ('kept');");
  await writable.close();
  const readOnly = new SqliteDatabaseClient(file, { readOnly: true });
  try {
    assert.deepEqual((await readOnly.all("SELECT * FROM records")).map((row) => ({ ...row })), [{ id: "kept" }]);
    await assert.rejects(readOnly.run("INSERT INTO records VALUES (?)", ["blocked"]), /readonly/i);
  } finally {
    await readOnly.close();
  }
  const missing = path.join(path.dirname(file), "missing", "no-create.sqlite");
  assert.throws(() => new SqliteDatabaseClient(missing, { readOnly: true }), /unable to open/i);
  assert.equal(existsSync(path.dirname(missing)), false);
});

test("postgres lifecycle double: all unit statements use one checked-out connection", async (t) => {
  const { db, calls } = pgFixture(t);
  const result = await db.transaction(async (tx) => {
    assert.equal(tx.transactionBound, true);
    await tx.exec("CREATE TABLE records (id TEXT); CREATE TABLE events (id TEXT)");
    assert.deepEqual(await tx.run("INSERT INTO records VALUES (?)", ["r1"]), { changes: 1 });
    assert.deepEqual(await tx.get("SELECT ? AS value", [1]), { value: 1 });
    assert.deepEqual(await tx.all("SELECT ? AS value", [1]), [{ value: 1 }]);
    assert.equal(await tx.columnExists("records", "id"), true);
    return "committed";
  });
  assert.equal(result, "committed");
  assert.ok(calls.every((call) => call.source === 1));
  assert.equal(calls[0].sql, "BEGIN");
  assert.equal(calls.at(-2).sql, "COMMIT");
  assert.equal(calls.at(-1).release, true);
  assert.equal(calls.at(-1).error, undefined);
  assert.ok(calls.some((call) => call.sql === "INSERT INTO records VALUES ($1)"));
});

test("postgres lifecycle double: callback failure rolls back and preserves the original error", async (t) => {
  const { db, calls } = pgFixture(t);
  const original = new Error("domain failure");
  await assert.rejects(db.transaction(async (tx) => {
    await tx.run("INSERT INTO records VALUES (?)", ["r1"]);
    throw original;
  }), (error) => error === original);
  assert.deepEqual(calls.filter((call) => call.sql).map((call) => call.sql), [
    "BEGIN", "INSERT INTO records VALUES ($1)", "ROLLBACK"
  ]);
  assert.equal(calls.at(-1).error, undefined);
});

test("postgres lifecycle double: caught statement failure aborts instead of accepting an aborted COMMIT", async (t) => {
  const original = new Error("constraint violation");
  const { db, calls } = pgFixture(t, { query(sql) {
    if (sql === "BAD WRITE") throw original;
    return { rows: [], rowCount: 0 };
  } });
  await assert.rejects(db.transaction(async (tx) => {
    await assert.rejects(tx.exec("BAD WRITE"), (error) => error === original);
  }), (error) => error === original);
  assert.equal(calls.some((call) => call.sql === "COMMIT"), false);
  assert.equal(calls.at(-2).sql, "ROLLBACK");
});

for (const failingCommand of ["BEGIN", "COMMIT", "ROLLBACK"]) {
  test("postgres lifecycle double: " + failingCommand + " failure discards the connection without replay", async (t) => {
    const queryError = new Error(failingCommand + " transport failure");
    const domainError = new Error("domain failure");
    const { db, calls } = pgFixture(t, { query(sql) {
      if (sql === failingCommand) throw queryError;
      return { rows: [], rowCount: 0 };
    } });
    let attempts = 0;
    await assert.rejects(db.transaction(async (tx) => {
      attempts += 1;
      await tx.exec("SELECT 1");
      if (failingCommand === "ROLLBACK") throw domainError;
    }), (error) => error === (failingCommand === "ROLLBACK" ? domainError : queryError));
    assert.equal(attempts, failingCommand === "BEGIN" ? 0 : 1);
    assert.equal(calls.at(-1).release, true);
    assert.equal(calls.at(-1).error, queryError);
    if (failingCommand === "BEGIN") assert.equal(calls.some((call) => call.sql === "ROLLBACK"), false);
  });
}

test("postgres lifecycle double: accepted queries finish before release, while later scoped work rejects", async (t) => {
  const queryStarted = deferred();
  const releaseQuery = deferred();
  const callbackEnded = deferred();
  const { db, calls } = pgFixture(t, { async query(sql) {
    if (sql === "SLOW WRITE") {
      queryStarted.resolve();
      await releaseQuery.promise;
    }
    return { rows: [], rowCount: 0 };
  } });
  let scoped;
  let pending;
  const transaction = db.transaction(async (tx) => {
    scoped = tx;
    pending = tx.exec("SLOW WRITE");
    callbackEnded.resolve();
  });
  await queryStarted.promise;
  await callbackEnded.promise;
  await turn();
  assert.equal(calls.some((call) => call.sql === "COMMIT" || call.release), false);
  await assert.rejects(scoped.exec("TOO LATE"), /Transaction-scoped client is closed/);
  releaseQuery.resolve();
  await pending;
  await transaction;
  assert.equal(calls.at(-2).sql, "COMMIT");
  assert.equal(calls.at(-1).release, true);
});

test("postgres lifecycle double: concurrent independent units use separate connections", async (t) => {
  const { db, calls, connections } = pgFixture(t);
  const entered = deferred();
  const proceed = deferred();
  const first = db.transaction(async (tx) => {
    entered.resolve();
    await proceed.promise;
    await tx.exec("FIRST");
  });
  await entered.promise;
  await db.transaction(async (tx) => { await tx.exec("SECOND"); });
  await db.get("OUTSIDE");
  assert.equal(connections.length, 2);
  assert.equal(calls.find((call) => call.sql === "SECOND").source, 2);
  assert.equal(calls.find((call) => call.sql === "OUTSIDE").source, "pool");
  proceed.resolve();
  await first;
  assert.equal(calls.find((call) => call.sql === "FIRST").source, 1);
});

test("sqlite: a deferred constraint failure during commit rolls back without replaying work", async (t) => {
  const db = sqliteFixture(t);
  await db.exec(`
    CREATE TABLE parents (id TEXT PRIMARY KEY);
    CREATE TABLE children (
      id TEXT PRIMARY KEY,
      parent_id TEXT REFERENCES parents(id) DEFERRABLE INITIALLY DEFERRED
    );
  `);
  let calls = 0;
  await assert.rejects(db.transaction(async (tx) => {
    calls += 1;
    await tx.run("INSERT INTO children VALUES (?, ?)", ["child", "missing"]);
  }), /FOREIGN KEY/);
  assert.equal(calls, 1);
  assert.deepEqual(await db.all("SELECT * FROM children"), []);
  await db.transaction(async (tx) => {
    await tx.run("INSERT INTO parents VALUES (?)", ["parent"]);
    await tx.run("INSERT INTO children VALUES (?, ?)", ["child", "parent"]);
  });
  assert.equal((await db.get("SELECT parent_id FROM children")).parent_id, "parent");
});

test("sqlite: a rollback cleanup failure retires the connection and preserves committed history", async (t) => {
  const file = tempFile(t);
  const db = new SqliteDatabaseClient(file);
  try {
    await db.exec("CREATE TABLE records (id TEXT UNIQUE ON CONFLICT ROLLBACK); INSERT INTO records VALUES ('kept');");
    await assert.rejects(db.transaction(async (tx) => {
      await tx.run("INSERT INTO records VALUES (?)", ["discarded"]);
      // SQLite itself rolls back this transaction before the wrapper can clean up.
      await tx.run("INSERT INTO records VALUES (?)", ["kept"]);
    }), /UNIQUE/);
    await assert.rejects(db.get("SELECT * FROM records"), /Database client is closed/);
  } finally {
    await db.close();
  }
  const reopened = new SqliteDatabaseClient(file);
  try {
    assert.deepEqual((await reopened.all("SELECT * FROM records")).map((row) => row.id), ["kept"]);
  } finally {
    await reopened.close();
  }
});

test("postgres: pool error logging redacts server text and exposes only whitelisted failure codes", async () => {
  const originalConsoleError = console.error;
  const logs = [];
  const pool = new EventEmitter();
  pool.end = async () => {};
  const db = new PostgresDatabaseClient(pool);
  console.error = (record) => { logs.push(JSON.parse(record)); };
  try {
    pool.emit("error", Object.assign(new Error("postgresql://user:do-not-log-this@private.invalid/db"), { code: "ECONNRESET" }));
    pool.emit("error", Object.assign(new Error("sensitive server detail"), { code: "password-not-for-logs" }));
    assert.equal(logs.length, 2);
    assert.equal(logs[0].code, "ECONNRESET");
    assert.equal(logs[1].code, "DATABASE_POOL_ERROR");
    assert.ok(logs.every((record) => record.event === "database.pool_error" && record.level === "error"));
    const serialized = JSON.stringify(logs);
    for (const secret of ["password-not-for-logs", "do-not-log-this", "private.invalid", "sensitive server detail"]) {
      assert.equal(serialized.includes(secret), false);
    }
  } finally {
    await db.close();
    console.error = originalConsoleError;
  }
});
