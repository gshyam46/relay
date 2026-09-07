import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../src/api/app.js";
import { createDatabase } from "../src/database/database.js";

test("CSV preview normalizes rows, preserves raw values, validates usable identity, and creates no leads", async (t) => {
  const client = await startClient(t);
  const organization = await client.post("/api/organizations", { name: "Preview Org" });

  const preview = await client.post("/api/imports/csv/preview", {
    organization_id: organization.organization.id,
    filename: "messy.csv",
    csv_text: [
      "Customer Name,Whatsapp,Organization,Email Address,Notes",
      " Priya Sharma ,09876543210, Northstar Interiors , Priya@Example.COM , quoted lead ",
      ",9876543211,Company With Phone,,",
      ",,Company Only,,"
    ].join("\n"),
    default_phone_region: "IN"
  });

  assert.equal(preview.import.state, "READY_TO_COMMIT");
  assert.equal(preview.import.summary.total_rows, 3);
  assert.equal(preview.import.summary.valid_rows, 2);
  assert.equal(preview.import.summary.invalid_rows, 1);
  assert.equal(preview.rows[0].raw_row.Whatsapp, "09876543210");
  assert.equal(preview.rows[0].raw_row.Notes, " quoted lead ");
  assert.equal(preview.rows[0].normalized_values.email, "priya@example.com");
  assert.equal(preview.rows[0].normalized_values.normalized_phone, "+919876543210");
  assert.equal(preview.rows[1].validation_state, "VALID");
  assert.equal(preview.rows[2].validation_state, "INVALID");
  assert.equal(client.db.all("SELECT * FROM leads WHERE organization_id = ?", [organization.organization.id]).length, 0);
});

test("CSV preview detects existing and in-file duplicate candidates without merging or skipping", async (t) => {
  const client = await startClient(t);
  const organization = await client.post("/api/organizations", { name: "Duplicate Org" });
  await client.post("/api/leads", {
    organization_id: organization.organization.id,
    name: "Existing Lead",
    email: "existing@example.com",
    phone: "+91 98765 43210",
    company: "Existing Co"
  });

  const preview = await client.post("/api/imports/csv/preview", {
    organization_id: organization.organization.id,
    filename: "duplicates.csv",
    csv_text: [
      "Name,Mobile,Company,Email",
      "Existing Email,9999911111,Other,existing@example.com",
      "Existing Phone,9876543210,Other,phone@example.com",
      "Nisha Rao,9999911112,Shared Co,nisha@example.com",
      "Nisha Rao,9999911113,Shared Co,nisha2@example.com",
      "Same Email,9999911114,Other,same@example.com",
      "Same Email Again,9999911115,Other,same@example.com"
    ].join("\n"),
    default_phone_region: "IN"
  });

  const duplicateTypes = preview.duplicate_candidates.map((candidate) => candidate.duplicate_type);
  assert.equal(duplicateTypes.includes("STRONG_EMAIL"), true);
  assert.equal(duplicateTypes.includes("STRONG_PHONE"), true);
  assert.equal(duplicateTypes.includes("POSSIBLE_NAME_COMPANY"), true);
  assert.equal(preview.import.summary.valid_rows, 6);
  assert.equal(client.db.all("SELECT * FROM leads WHERE organization_id = ?", [organization.organization.id]).length, 1);
});

test("commit creates leads for valid selected rows, records provenance, and is idempotent", async (t) => {
  const client = await startClient(t);
  const organization = await client.post("/api/organizations", { name: "Commit Org" });
  const preview = await client.post("/api/imports/csv/preview", {
    organization_id: organization.organization.id,
    filename: "commit.csv",
    csv_text: [
      "Name,Mobile,Company,Email",
      "Priya Sharma,9876543210,Northstar Interiors,priya@example.com",
      ",9876543211,Company Phone,",
      ",,Company Only,"
    ].join("\n"),
    default_phone_region: "IN"
  });
  const validRowIds = preview.rows.filter((row) => row.validation_state === "VALID").map((row) => row.id);
  const invalidRowId = preview.rows.find((row) => row.validation_state === "INVALID").id;

  const invalidCommit = await fetch(`${client.baseUrl}/api/imports/${preview.import.id}/commit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      organization_id: organization.organization.id,
      selected_row_ids: [invalidRowId]
    })
  });
  assert.equal(invalidCommit.status, 400);
  assert.equal(client.db.all("SELECT * FROM leads WHERE organization_id = ?", [organization.organization.id]).length, 0);

  const firstCommit = await client.post(`/api/imports/${preview.import.id}/commit`, {
    organization_id: organization.organization.id,
    selected_row_ids: validRowIds
  });
  const secondCommit = await client.post(`/api/imports/${preview.import.id}/commit`, {
    organization_id: organization.organization.id,
    selected_row_ids: validRowIds
  });

  assert.equal(firstCommit.import.state, "COMMITTED");
  assert.equal(secondCommit.import.state, "COMMITTED");
  assert.equal(client.db.all("SELECT * FROM leads WHERE organization_id = ?", [organization.organization.id]).length, 2);
  assert.equal(client.db.all("SELECT * FROM domain_events WHERE type = 'LeadCreated'").length, 2);
  const importedLead = client.db.get("SELECT * FROM leads WHERE email = ?", ["priya@example.com"]);
  assert.equal(importedLead.source, "CSV");
  assert.equal(importedLead.normalized_phone, "+919876543210");
  assert.equal(importedLead.import_batch_id, preview.import.id);
  assert.ok(importedLead.import_row_id);
});

test("commit retry after partial failure does not duplicate already committed rows", async (t) => {
  const client = await startClient(t);
  const organization = await client.post("/api/organizations", { name: "Retry Import Org" });
  const preview = await client.post("/api/imports/csv/preview", {
    organization_id: organization.organization.id,
    filename: "retry.csv",
    csv_text: "Name,Mobile,Company\nAsha,9876543210,One\nKabir,9876543211,Two",
    default_phone_region: "IN"
  });
  const rowIds = preview.rows.map((row) => row.id);

  const failed = await fetch(`${client.baseUrl}/api/imports/${preview.import.id}/commit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      organization_id: organization.organization.id,
      selected_row_ids: rowIds,
      simulate_failure_after_rows: 1
    })
  });
  assert.equal(failed.status, 500);
  assert.equal(client.db.get("SELECT state FROM import_batches WHERE id = ?", [preview.import.id]).state, "FAILED");
  assert.equal(client.db.all("SELECT * FROM leads WHERE organization_id = ?", [organization.organization.id]).length, 1);

  const retried = await client.post(`/api/imports/${preview.import.id}/commit`, {
    organization_id: organization.organization.id,
    selected_row_ids: rowIds
  });

  assert.equal(retried.import.state, "COMMITTED");
  assert.equal(client.db.all("SELECT * FROM leads WHERE organization_id = ?", [organization.organization.id]).length, 2);
});

test("import state and committed leads survive application restart", async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ai-lead-m1-"));
  const databaseFile = path.join(tempDir, "app.db");
  let firstClient;
  let secondClient;

  try {
    firstClient = await startClient(t, databaseFile, { autoCleanup: false });
    const organization = await firstClient.post("/api/organizations", { name: "Restart Import Org" });
    const preview = await firstClient.post("/api/imports/csv/preview", {
      organization_id: organization.organization.id,
      filename: "restart.csv",
      csv_text: "Name,Email\nMeera Das,meera@example.com",
      default_phone_region: "INTERNATIONAL_ONLY"
    });
    await firstClient.post(`/api/imports/${preview.import.id}/commit`, {
      organization_id: organization.organization.id,
      selected_row_ids: preview.rows.map((row) => row.id)
    });
    await firstClient.stop();

    secondClient = await startClient(t, databaseFile, { autoCleanup: false });
    const persistedImport = await secondClient.get(
      `/api/imports/${preview.import.id}?organization_id=${organization.organization.id}`
    );
    const leads = await secondClient.get(`/api/leads?organization_id=${organization.organization.id}&source=CSV`);

    assert.equal(persistedImport.import.state, "COMMITTED");
    assert.equal(persistedImport.rows[0].committed, true);
    assert.equal(leads.leads.length, 1);
    assert.equal(leads.leads[0].import_batch_id, preview.import.id);
  } finally {
    await firstClient?.stop();
    await secondClient?.stop();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("imports and imported leads remain organization scoped", async (t) => {
  const client = await startClient(t);
  const firstOrg = await client.post("/api/organizations", { name: "Tenant A" });
  const secondOrg = await client.post("/api/organizations", { name: "Tenant B" });
  const preview = await client.post("/api/imports/csv/preview", {
    organization_id: firstOrg.organization.id,
    filename: "tenant.csv",
    csv_text: "Name,Email\nTenant Lead,tenant@example.com",
    default_phone_region: "INTERNATIONAL_ONLY"
  });

  const crossTenantGet = await fetch(
    `${client.baseUrl}/api/imports/${preview.import.id}?organization_id=${secondOrg.organization.id}`
  );
  assert.equal(crossTenantGet.status, 404);

  const crossTenantCommit = await fetch(`${client.baseUrl}/api/imports/${preview.import.id}/commit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      organization_id: secondOrg.organization.id,
      selected_row_ids: preview.rows.map((row) => row.id)
    })
  });
  assert.equal(crossTenantCommit.status, 404);

  await client.post(`/api/imports/${preview.import.id}/commit`, {
    organization_id: firstOrg.organization.id,
    selected_row_ids: preview.rows.map((row) => row.id)
  });
  assert.equal((await client.get(`/api/leads?organization_id=${firstOrg.organization.id}`)).leads.length, 1);
  assert.equal((await client.get(`/api/leads?organization_id=${secondOrg.organization.id}`)).leads.length, 0);
  assert.equal(client.db.all("SELECT * FROM import_rows WHERE organization_id = ?", [secondOrg.organization.id]).length, 0);
  assert.equal(client.db.all("SELECT * FROM import_issues WHERE organization_id = ?", [secondOrg.organization.id]).length, 0);
});

test("lead list search and filters use persisted lead fields", async (t) => {
  const client = await startClient(t);
  const organization = await client.post("/api/organizations", { name: "Search Org" });
  await client.post("/api/leads", {
    organization_id: organization.organization.id,
    name: "Manual Lead",
    email: "manual@example.com",
    company: "Manual Co"
  });
  const preview = await client.post("/api/imports/csv/preview", {
    organization_id: organization.organization.id,
    filename: "search.csv",
    csv_text: "Name,Email,Company\nImported Lead,imported@example.com,Import Co",
    default_phone_region: "INTERNATIONAL_ONLY"
  });
  await client.post(`/api/imports/${preview.import.id}/commit`, {
    organization_id: organization.organization.id,
    selected_row_ids: preview.rows.map((row) => row.id)
  });

  const bySearch = await client.get(`/api/leads?organization_id=${organization.organization.id}&search=import`);
  const bySource = await client.get(`/api/leads?organization_id=${organization.organization.id}&source=CSV`);
  const emptySearch = await client.get(`/api/leads?organization_id=${organization.organization.id}&search=missing`);

  assert.deepEqual(bySearch.leads.map((lead) => lead.name), ["Imported Lead"]);
  assert.deepEqual(bySource.leads.map((lead) => lead.source), ["CSV"]);
  assert.equal(emptySearch.leads.length, 0);
});

async function startClient(t, databaseFile = ":memory:", { autoCleanup = true } = {}) {
  const db = createDatabase(databaseFile);
  const server = createApp({ db });
  let stopped = false;

  await new Promise((resolve) => server.listen(0, resolve));
  if (autoCleanup) {
    t.after(() => stop());
  }

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  async function stop() {
    if (stopped) {
      return;
    }
    stopped = true;
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }

  return {
    baseUrl,
    db,
    stop,
    async get(route) {
      const response = await fetch(`${baseUrl}${route}`);
      if (!response.ok) {
        assert.fail(`${response.status} ${await response.text()}`);
      }
      return response.json();
    },
    async post(route, body) {
      const response = await fetch(`${baseUrl}${route}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        assert.fail(`${response.status} ${await response.text()}`);
      }
      return response.json();
    }
  };
}
