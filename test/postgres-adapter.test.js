import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase, getMigrationStatus } from "../src/database/database.js";
import { connectTestAdmin, postgresTestContext, schemaDatabaseConfig, schemaFor } from "../scripts/helpers/testSafety.js";
import { startClient } from "./helpers/testClient.js";

// Only the explicit disposable-target runner enables real PostgreSQL tests.
// An inherited application DATABASE_URL never activates or selects them.
const context = postgresTestContext();
const skip = context ? false : "Run npm run test:pg with an explicitly acknowledged disposable database";

async function withScopedSchema(t) {
  const schema = schemaFor(context.runId, "adapter");
  const admin = await connectTestAdmin(context);
  try {
    await admin.exec('CREATE SCHEMA "' + schema + '"');
  } finally {
    await admin.close();
  }
  t.after(async () => {
    const cleanup = await connectTestAdmin(context);
    try {
      await cleanup.exec('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE');
    } finally {
      await cleanup.close();
    }
  });
  return { schema, config: schemaDatabaseConfig(context, schema) };
}

test("postgres: migrations apply cleanly to an empty schema and are idempotent", { skip }, async (t) => {
  const { config } = await withScopedSchema(t);
  const db = await createDatabase(config);
  try {
    const status = await getMigrationStatus(db);
    assert.deepEqual(status.pending, []);
    assert.equal(status.applied.length, status.total);
    assert.ok(status.total >= 1);

    // Re-opening must not re-apply, and must not fail on already-existing objects.
    const again = await createDatabase(config);
    assert.deepEqual((await getMigrationStatus(again)).pending, []);
    assert.equal((await getMigrationStatus(again)).applied.length, status.total);
    await again.close();
  } finally {
    await db.close();
  }
});

test("postgres: the client contract behaves exactly as it does on sqlite", { skip }, async (t) => {
  const { config } = await withScopedSchema(t);
  const db = await createDatabase(config);
  try {
    // `?` placeholders are translated, not passed through.
    await db.run("INSERT INTO organizations (id, name, created_at) VALUES (?, ?, ?)", [
      "org_pg",
      "Postgres Workspace",
      "2026-01-01T00:00:00.000Z"
    ]);
    assert.equal((await db.get("SELECT name FROM organizations WHERE id = ?", ["org_pg"])).name, "Postgres Workspace");
    assert.equal(await db.get("SELECT * FROM organizations WHERE id = ?", ["missing"]), undefined);
    assert.equal((await db.all("SELECT * FROM organizations")).length, 1);

    // COUNT/SUM come back as JavaScript numbers, not the strings pg returns for
    // BIGINT and NUMERIC by default. Every dashboard total depends on this.
    const counted = await db.get("SELECT COUNT(*) AS count FROM organizations");
    assert.equal(typeof counted.count, "number");
    assert.equal(counted.count, 1);
    const summed = await db.get("SELECT COALESCE(SUM(1), 0) AS total FROM organizations");
    assert.equal(typeof summed.total, "number");

    assert.equal(await db.columnExists("leads", "normalized_email"), true);
    assert.equal(await db.columnExists("leads", "not_a_real_column"), false);

    // Rollback really rolls back.
    await assert.rejects(
      () =>
        db.transaction(async (tx) => {
          await tx.run("INSERT INTO organizations (id, name, created_at) VALUES (?, ?, ?)", [
            "org_rollback",
            "Gone",
            "2026-01-01T00:00:00.000Z"
          ]);
          throw new Error("boom");
        }),
      /boom/
    );
    assert.equal(await db.get("SELECT * FROM organizations WHERE id = ?", ["org_rollback"]), undefined);
  } finally {
    await db.close();
  }
});

test("postgres: unique constraints still enforce idempotency keys", { skip }, async (t) => {
  const { config } = await withScopedSchema(t);
  const db = await createDatabase(config);
  try {
    await db.run("INSERT INTO organizations (id, name, created_at) VALUES (?, ?, ?)", [
      "org_u",
      "U",
      "2026-01-01T00:00:00.000Z"
    ]);
    const insertBatch = () =>
      db.run(
        `INSERT INTO import_batches
           (id, organization_id, filename, adapter_type, source_metadata_json, state, idempotency_key, summary_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          "imp_1",
          "org_u",
          "a.csv",
          "CSV",
          "{}",
          "UPLOADED",
          "same-key",
          "{}",
          "2026-01-01T00:00:00.000Z",
          "2026-01-01T00:00:00.000Z"
        ]
      );
    await insertBatch();
    await assert.rejects(insertBatch, /duplicate key|unique/i);
  } finally {
    await db.close();
  }
});

test("postgres: the full product flow works end to end over the API", { skip }, async (t) => {
  const { config } = await withScopedSchema(t);
  const client = await startClient(t, config);

  const organization = await client.register("Postgres End To End");
  const organizationId = organization.organization.id;

  const lead = await client.post("/api/leads", {
    organization_id: organizationId,
    name: "Priya Sharma",
    email: "priya@example.com",
    phone: "+91 98765 43210",
    company: "Sharma Interiors",
    source: "MANUAL"
  });
  assert.ok(lead.lead.id);

  const leads = await client.get(`/api/leads?organization_id=${organizationId}`);
  assert.equal(leads.leads.length, 1);

  const intelligence = await client.post(`/api/leads/${lead.lead.id}/intelligence/run`, {
    organization_id: organizationId
  });
  assert.equal(intelligence.intelligence.status, "READY");
  assert.ok(intelligence.intelligence.evidence.length > 0, "evidence must be persisted and read back");

  const synthesis = await client.post(`/api/leads/${lead.lead.id}/synthesis/run`, { organization_id: organizationId });
  assert.equal(synthesis.synthesis.status, "READY");
  assert.ok(synthesis.synthesis.findings.length > 0);

  const recommendation = await client.post(`/api/leads/${lead.lead.id}/intelligence-recommendation/run`, {
    organization_id: organizationId
  });
  assert.equal(recommendation.intelligence_recommendation.status, "READY");

  const plan = await client.post(`/api/leads/${lead.lead.id}/next-best-action/plan`, {
    organization_id: organizationId
  });
  assert.equal(plan.next_best_action_plan.status, "PLANNED");

  // Dashboard aggregates exercise COUNT/SUM/GROUP BY across the schema.
  const dashboard = await client.get(`/api/dashboard/metrics?organization_id=${organizationId}`);
  assert.equal(typeof dashboard.leads.total, "number", "COUNT(*) must arrive as a number, not a pg BIGINT string");
  assert.equal(dashboard.leads.total, 1);

  // Tenant isolation holds on Postgres too.
  const other = await startClient(t, config);
  await other.register("Other Postgres Workspace");
  const crossTenant = await other.rawFetch(`/api/leads/${lead.lead.id}?organization_id=${organizationId}`);
  assert.equal(crossTenant.status === 403 || crossTenant.status === 404, true);
});
