import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDatabase, openDatabaseClient } from "../src/database/database.js";
import { AuthAdmissionService } from "../src/modules/auth/authAdmissionService.js";
import { connectTestAdmin, postgresTestContext, schemaDatabaseConfig, schemaFor } from "../scripts/helpers/testSafety.js";

const SECRET = "synthetic-admission-secret-only-for-tests", NOW = Date.parse("2026-09-11T10:00:00.000Z");
const INPUT = { operation: "LOGIN", peerAddress: "127.0.0.1", email: "person@example.test" };
const cleanups = new WeakMap();
function cleanup(t, fn) { if (!cleanups.has(t)) { const list = []; cleanups.set(t, list); t.after(async () => { for (const release of list) await release(); }); } cleanups.get(t).unshift(fn); }
async function fixture(t, target = ":memory:") {
  const db = await createDatabase(target); cleanup(t, () => db.close()); let now = NOW;
  const service = new AuthAdmissionService({ db, secret: SECRET, now: () => now });
  return { db, service, time: (value) => { now = value; } };
}
function pause() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
async function file(t) { const directory = await mkdtemp(path.join(os.tmpdir(), "lead-auth-admission-")); cleanup(t, () => rm(directory, { recursive: true, force: true })); return path.join(directory, "owned.sqlite"); }
const count = async (db) => Number((await db.get("SELECT COUNT(*) AS n FROM auth_rate_buckets")).n);

test("normalized account budget counts successes and failures without storing raw identities", async (t) => {
  const f = await fixture(t); let work = 0;
  for (let index = 0; index < 10; index++) await f.service.run({ ...INPUT, email: index % 2 ? " PERSON@EXAMPLE.TEST " : INPUT.email }, async () => { work++; });
  const rows = await f.db.all("SELECT * FROM auth_rate_buckets");
  assert.equal(rows.filter((row) => row.bucket_kind === "ACCOUNT").length, 1);
  assert.equal(JSON.stringify(rows).includes(INPUT.email), false); assert.equal(JSON.stringify(rows).includes(INPUT.peerAddress), false);
  await assert.rejects(f.service.run(INPUT, async () => { work++; }), { statusCode: 429, code: "AUTH_RATE_LIMITED", retryAfterSeconds: 900 });
  assert.equal(work, 10);
  const before = await f.db.all("SELECT * FROM auth_rate_buckets ORDER BY operation,bucket_kind");
  f.time(NOW + 30000);
  await assert.rejects(f.service.run(INPUT, async () => { work++; }), { retryAfterSeconds: 870 });
  assert.deepEqual(await f.db.all("SELECT * FROM auth_rate_buckets ORDER BY operation,bucket_kind"), before);
});

test("global, socket and registration budgets each bound distinct identities", async (t) => {
  for (const kind of ["peer", "global", "registration"]) await t.test(kind, async (t) => {
    const f = await fixture(t);
    const limit = kind === "peer" ? 30 : kind === "global" ? 200 : 3;
    for (let index = 0; index < limit; index++) await f.service.admit({ ...INPUT, operation: kind === "registration" ? "REGISTER" : "LOGIN",
      email: kind === "registration" ? INPUT.email : "person" + index + "@example.test", peerAddress: kind === "global" ? "198.51.100." + (index + 1) : INPUT.peerAddress });
    await assert.rejects(f.service.admit({ ...INPUT, operation: kind === "registration" ? "REGISTER" : "LOGIN",
      email: kind === "registration" ? INPUT.email : "extra@example.test", peerAddress: kind === "global" ? "198.51.100.250" : INPUT.peerAddress }), { statusCode: 429, code: "AUTH_RATE_LIMITED" });
  });
});

test("secret rotation does not reset the independent global budget", async (t) => {
  const f = await fixture(t);
  for (let index = 0; index < 20; index++) await f.service.admit({ operation: "REGISTER", peerAddress: "198.51.100." + (index + 1), email: "new" + index + "@example.test" });
  const rotated = new AuthAdmissionService({ db: f.db, secret: "different-synthetic-secret-for-rotation", now: () => NOW });
  await assert.rejects(rotated.admit({ ...INPUT, operation: "REGISTER" }), { statusCode: 429, code: "AUTH_RATE_LIMITED", retryAfterSeconds: 3600 });
});

test("durable budgets survive actual reopen, ignore backward clock and reset only at expiry", async (t) => {
  const target = await file(t), f = await fixture(t, target);
  for (let index = 0; index < 10; index++) await f.service.admit(INPUT);
  await f.db.close();
  const reopened = await openDatabaseClient(target); cleanup(t, () => reopened.close()); let clock = NOW - 60000;
  const service = new AuthAdmissionService({ db: reopened, secret: SECRET, now: () => clock });
  await assert.rejects(service.admit(INPUT), { retryAfterSeconds: 960 });
  clock = NOW + 900000;
  await service.admit(INPUT);
  assert.equal((await reopened.get("SELECT attempts FROM auth_rate_buckets WHERE bucket_kind='ACCOUNT'")).attempts, 1);
});

async function simultaneous(db, other) {
  const services = [db, other].map((client) => new AuthAdmissionService({ db: client, secret: SECRET, now: () => NOW }));
  const result = await Promise.allSettled(Array.from({ length: 12 }, (_, index) => services[index % 2].admit(INPUT)));
  assert.equal(result.filter((item) => item.status === "fulfilled").length, 10);
  assert.equal(result.filter((item) => item.status === "rejected" && item.reason.code === "AUTH_RATE_LIMITED").length, 2);
  assert.equal((await db.get("SELECT attempts FROM auth_rate_buckets WHERE bucket_kind='ACCOUNT'")).attempts, 10);
}
test("two SQLite connections cannot spend the same remaining account capacity", async (t) => {
  const target = await file(t), f = await fixture(t, target), other = await openDatabaseClient(target); cleanup(t, () => other.close());
  await simultaneous(f.db, other);
});

test("two nonqueued slots release on every outcome and work executes outside the admission transaction", async (t) => {
  const f = await fixture(t), entered = pause(), release = pause(); let started = 0;
  const work = async () => { assert.ok(await f.db.get("SELECT id FROM auth_admission_state")); started++; if (started === 2) entered.resolve(); await release.promise; throw new Error("synthetic hash failure"); };
  const first = f.service.run(INPUT, work), second = f.service.run(INPUT, work);
  const completion = Promise.allSettled([first, second]); await entered.promise;
  await assert.rejects(f.service.run(INPUT, () => assert.fail("No queued hash work")), { statusCode: 503, code: "AUTH_BUSY", retryAfterSeconds: 1 });
  release.resolve(); await completion; assert.equal(f.service.active, 0);
  await f.service.run(INPUT, async () => {}); assert.equal(f.service.active, 0);
  assert.equal((await f.db.get("SELECT attempts FROM auth_rate_buckets WHERE operation='LOGIN' AND bucket_kind='GLOBAL'")).attempts, 3);
});

test("admission storage failure rolls back all counters and never invokes hash work", async (t) => {
  const f = await fixture(t); let work = 0;
  await f.db.exec("CREATE TRIGGER fail_admission BEFORE UPDATE ON auth_admission_state BEGIN SELECT RAISE(ABORT,'synthetic database secret'); END");
  await assert.rejects(f.service.run(INPUT, async () => { work++; }), (error) => error.code === "AUTH_ADMISSION_UNAVAILABLE" && !error.message.includes("secret"));
  assert.equal(work, 0); assert.equal(f.service.active, 0); assert.equal(await count(f.db), 2);
  await f.db.exec("DROP TRIGGER fail_admission"); await f.service.run(INPUT, async () => { work++; }); assert.equal(work, 1);
});

test("counter cardinality is bounded and cleanup removes at most100 expired identities", async (t) => {
  const f = await fixture(t), timestamp = new Date(NOW).toISOString(), future = new Date(NOW + 3600000).toISOString();
  await f.db.run("WITH RECURSIVE ids(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM ids WHERE n<9998) INSERT INTO auth_rate_buckets SELECT 'LOGIN','ACCOUNT',printf('%064x',n),?,?,1 FROM ids", [timestamp, future]);
  assert.equal(await count(f.db), 10000);
  await assert.rejects(f.service.run(INPUT, () => assert.fail("No work above capacity")), { code: "AUTH_ADMISSION_UNAVAILABLE", statusCode: 503 });
  assert.equal(await count(f.db), 10000);
  await f.db.run("UPDATE auth_rate_buckets SET reset_at=? WHERE bucket_kind='ACCOUNT'", [timestamp]);
  await f.service.admit(INPUT);
  assert.equal(await count(f.db), 9902);
});

test("invalid persisted budget timestamps fail closed without hash work", async (t) => {
  const f = await fixture(t);
  await f.db.run("UPDATE auth_rate_buckets SET reset_at='invalid' WHERE operation='LOGIN' AND bucket_kind='GLOBAL'");
  await assert.rejects(f.service.run(INPUT, () => assert.fail("No work with corrupt budget")), { code: "AUTH_ADMISSION_UNAVAILABLE" });
});

const context = postgresTestContext();
test("postgres auth admissions serialize across independent clients", { skip: context ? false : "Requires explicit disposable PostgreSQL runner" }, async (t) => {
  const schema = schemaFor(context.runId, "adapter"), admin = await connectTestAdmin(context);
  try { await admin.exec('CREATE SCHEMA "' + schema + '"'); } finally { await admin.close(); }
  cleanup(t, async () => { const admin = await connectTestAdmin(context); try { await admin.exec('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE'); } finally { await admin.close(); } });
  const target = schemaDatabaseConfig(context, schema), f = await fixture(t, target), other = await openDatabaseClient(target); cleanup(t, () => other.close());
  await simultaneous(f.db, other);
});

test("cleanup never erases malformed identity state to replenish an account or peer budget", async (t) => {
  for (const [kind, patch] of [["ACCOUNT", "reset_at=''"], ["PEER", "window_started_at='invalid',reset_at='1970-01-01T00:00:00.000Z'"]]) await t.test(kind, async (t) => {
    const f = await fixture(t); await f.service.admit(INPUT);
    await f.db.run("UPDATE auth_rate_buckets SET " + patch + " WHERE bucket_kind=?", [kind]);
    await assert.rejects(f.service.run(INPUT, () => assert.fail("Corruption cannot reset admission")), { code: "AUTH_ADMISSION_UNAVAILABLE" });
    assert.ok(await f.db.get("SELECT * FROM auth_rate_buckets WHERE bucket_kind=?", [kind]));
  });
});
