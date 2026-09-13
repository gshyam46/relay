import test from "node:test";
import assert from "node:assert/strict";
import { SqliteDatabaseClient } from "../src/database/sqliteClient.js";
import { runMigrations } from "../src/database/migrate.js";
import { LeadsRepository } from "../src/modules/data-foundation/leadsRepository.js";
import { LeadDataService } from "../src/modules/data-foundation/leadDataService.js";
import { LeadExportService } from "../src/modules/data-foundation/leadExportService.js";
import { parseCsv } from "../src/modules/data-foundation/csvParser.js";
import { BusinessContextService } from "../src/modules/business-context/businessContextService.js";
import { emptyEnquiry } from "../src/modules/business-context/businessContextContract.js";
const actor = { id: "owner", role: "OWNER" }, stamp = "2026-09-12T10:00:00.000Z";
async function setup(t) {
  const db = new SqliteDatabaseClient(":memory:"); t.after(() => db.close()); await runMigrations(db);
  for (const [org, owner] of [["org", "owner"], ["other", "other-owner"]]) { await db.run("INSERT INTO organizations(id,name,created_at) VALUES (?,?,?)", [org, "Synthetic", stamp]); await db.run("INSERT INTO users(id,organization_id,name,email,role,created_at) VALUES (?,?,?,?,'OWNER',?)", [owner, org, "Synthetic", owner + "@example.test", stamp]); }
  return { db, leads: new LeadsRepository(db), data: new LeadDataService(db), exporter: new LeadExportService(db) };
}
const exportInput = ids => ({ organization_id: "org", actor, lead_ids: ids });
const source = reference => ({ source_type: "MANUAL", assertion: "CUSTOMER_STATED", source_reference: reference, observed_at: "2026-09-12T10:00:00.000Z" });
test("operational export preserves exact budgets, conflicts, unknowns and canonical contact strings", async t => {
  const { db, leads, exporter, data } = await setup(t), lead = await leads.createLead({ organization_id: "org", name: '=HYPERLINK("example.invalid")', email: "exact@example.test", phone: "+919876543210", company: "001234567890123456789" });
  const enquiry = emptyEnquiry(); enquiry.budget = { state: "KNOWN", value: { currency: "INR", minimum: "9007199254740993.01", maximum: "9007199254740993.09" }, provenance: source("Exact budget") };
  enquiry.interest = { state: "CONFLICTED", alternatives: [{ value: "Table", provenance: source("First source") }, { value: "Chair", provenance: source("Second source") }] };
  await new BusinessContextService(db).updateEnquiry({ organization_id: "org", lead_id: lead.id, actor, expected_revision: 0, reason: "Source fact capture", enquiry });
  await data.setArchived({ organization_id: "org", lead_id: lead.id, actor, expected_revision: 0, archived: true, reason: "Include archived selected source" });
  const output = await exporter.exportSelected(exportInput([lead.id])), parsed = parseCsv(output.csv_text), row = parsed.records[0].rawRow;
  assert.equal(output.row_count, 1); assert.equal(parsed.records.length, 1); assert.equal(parsed.issues.length, 0); assert.equal(row.name, 'text: =HYPERLINK("example.invalid")'); assert.equal(row.company, "text: 001234567890123456789");
  assert.equal(row.budget_minimum_exact, "text: 9007199254740993.01"); assert.equal(row.budget_maximum_exact, "text: 9007199254740993.09"); assert.equal(row.archived, "true");
  const exact = JSON.parse(row.enquiry_json), contact = JSON.parse(row.contact_json); assert.equal(exact.budget.value.minimum_minor, "900719925474099301"); assert.equal(exact.interest.state, "CONFLICTED"); assert.equal(exact.interest.alternatives.length, 2); assert.equal(exact.location.state, "UNKNOWN"); assert.equal(contact.company, lead.company); assert.equal(contact.phone, lead.phone);
});
test("CSV exports guard controls/fullwidth/separators while preserving the source in canonical JSON", async t => {
  const { leads, exporter } = await setup(t), dangerous = String.fromCodePoint(0xFF1D) + '1+1",@SUM(2)', lead = await leads.createLead({ organization_id: "org", name: dangerous, email: "unicode@example.test", company: "tab\r\nvalue" });
  const row = parseCsv((await exporter.exportSelected(exportInput([lead.id]))).csv_text).records[0].rawRow;
  assert.equal(row.name, "text: " + dangerous); assert.equal(row.company, lead.company); assert.equal(JSON.parse(row.contact_json).name, dangerous); assert.equal(JSON.parse(row.contact_json).company, lead.company);
});
test("export validates the entire selection and rejects output overflow without partial audit", async t => {
  const { db, leads, exporter } = await setup(t), ids = [];
  for (let index = 0; index < 1000; index++) ids.push((await leads.createLead({ organization_id: "org", name: "Synthetic " + index, email: "selected" + index + "@example.test" })).id);
  const output = await exporter.exportSelected(exportInput(ids)); assert.equal(output.row_count, 1000); assert.equal(parseCsv(output.csv_text).records.length, 1000);
  const originalAudits = Number((await db.get("SELECT count(*) n FROM audit_logs WHERE event_type='LeadDataExported'")).n);
  const foreign = await leads.createLead({ organization_id: "other", name: "Foreign", email: "foreign@example.test" });
  for (const lead_ids of [[], [ids[0], ids[0]], [ids[0], foreign.id], [...ids, "extra"]]) await assert.rejects(exporter.exportSelected(exportInput(lead_ids)), error => error.statusCode >= 400 && error.statusCode < 500);
  await db.run("UPDATE leads SET name=? WHERE id=?", ["Large" + "x".repeat(5 * 1024 * 1024), ids[0]]);
  await assert.rejects(exporter.exportSelected(exportInput([ids[0], ids[1]])), { code: "LEAD_EXPORT_LIMIT", statusCode: 413 });
  assert.equal(Number((await db.get("SELECT count(*) n FROM audit_logs WHERE event_type='LeadDataExported'")).n), originalAudits);
});
test("directory keyset pagination survives newer inserts and keeps archive/tenant scope", async t => {
  const { db, leads, data } = await setup(t), ids = [];
  for (let index = 0; index < 4; index++) { const lead = await leads.createLead({ organization_id: "org", name: "Directory " + index, email: "directory" + index + "@example.test" }); ids.push(lead.id); await db.run("UPDATE leads SET created_at=? WHERE id=?", [stamp, lead.id]); }
  await leads.createLead({ organization_id: "other", name: "Directory foreign", email: "foreign@example.test" });
  const first = await data.directory({ organization_id: "org", search: "Directory", limit: "2" });
  await leads.createLead({ organization_id: "org", name: "Directory later", email: "later@example.test" });
  const next = await data.directory({ organization_id: "org", search: "Directory", limit: "2", cursor: first.next_cursor });
  assert.equal(new Set([...first.leads, ...next.leads].map(lead => lead.id)).size, 4); assert.equal(next.total, 5);
  await assert.rejects(data.directory({ organization_id: "other", search: "Directory", cursor: first.next_cursor }), { code: "LEAD_DATA_INVALID_CURSOR" });
  await data.setArchived({ organization_id: "org", lead_id: ids[0], actor, expected_revision: 0, archived: true, reason: "Archived row" });
  assert.equal((await data.directory({ organization_id: "org" })).total, 4); assert.equal((await data.directory({ organization_id: "org", archive: "ARCHIVED" })).total, 1);
  assert.equal((await leads.listLeads("org")).length, 4); assert.equal((await leads.listLeads("org", { archive: "ALL" })).length, 5);
});
test("directory marks oversized display values without mutating legacy data", async t => {
  const { db, leads, data } = await setup(t), lead = await leads.createLead({ organization_id: "org", name: "Original", email: "legacy@example.test" });
  await db.run("UPDATE leads SET name=? WHERE id=?", ["x".repeat(40000), lead.id]);
  const directory = await data.directory({ organization_id: "org" }); assert.equal(directory.leads[0].name.length, 4096); assert.ok(directory.leads[0].truncated_fields.includes("name")); assert.equal((await leads.getLead(lead.id)).name.length, 40000);
});
test("history pages materialize below8MiB and expose the cursor to omitted changes", async t => {
  const { db, leads, data } = await setup(t), lead = await leads.createLead({ organization_id: "org", name: "Legacy", email: "legacy@example.test" });
  await db.run("UPDATE leads SET name=? WHERE id=?", ["x".repeat(190000), lead.id]);
  for (let revision = 0; revision < 12; revision++) await data.setArchived({ organization_id: "org", lead_id: lead.id, actor, expected_revision: revision, archived: revision % 2 === 0, reason: "Explicit historical archive transition" });
  const page = await data.get({ organization_id: "org", lead_id: lead.id, limit: "50" });
  assert.equal(page.history.has_more, true); assert.ok(page.history.changes.length > 0 && page.history.changes.length < 12); assert.ok(Buffer.byteLength(JSON.stringify(page.history.changes), "utf8") <= 8 * 1024 * 1024 + 100);
  const next = await data.get({ organization_id: "org", lead_id: lead.id, limit: "50", before_revision: String(page.history.next_before_revision) }); assert.equal(page.history.changes.length + next.history.changes.length, 12);
});

function observeReads(db) {
  const statements = [], transaction = db.transaction.bind(db);
  db.transaction = (work, options) => transaction(async tx => {
    for (const method of ["get", "all"]) {
      const original = tx[method].bind(tx); tx[method] = (sql, parameters) => { statements.push(sql); return original(sql, parameters); };
    }
    return work(tx);
  }, options);
  return statements;
}
test("export omits unrelated large source metadata and rejects oversized UTF8 fields before materialization", async t => {
  const { db, leads, exporter } = await setup(t), lead = await leads.createLead({ organization_id: "org", name: "Bounded", email: "bounded@example.test" });
  await db.run("UPDATE leads SET source_metadata_json=? WHERE id=?", [JSON.stringify({ legacy: "x".repeat(9 * 1024 * 1024) }), lead.id]);
  const reads = observeReads(db);
  const result = await exporter.exportSelected(exportInput([lead.id])); assert.equal(result.row_count, 1);
  assert.ok(reads.some(sql => sql.includes("AS identity_bytes") && sql.includes("d.after_json") && sql.includes("e.enquiry_json")));
  assert.ok(reads.every(sql => !sql.includes("source_metadata_json") && !/SELECT \* FROM leads\b/i.test(sql)));
  const originalAudits = Number((await db.get("SELECT count(*) n FROM audit_logs WHERE event_type='LeadDataExported'")).n);
  // UTF8 bytes exceed the cap although the character count is below it.
  await db.run("UPDATE leads SET name=? WHERE id=?", [String.fromCodePoint(0x20AC).repeat(3 * 1024 * 1024), lead.id]);
  reads.length = 0;
  await assert.rejects(exporter.exportSelected(exportInput([lead.id])), { code: "LEAD_EXPORT_LIMIT", statusCode: 413 });
  assert.ok(reads.some(sql => sql.includes("AS identity_bytes")));
  assert.ok(reads.every(sql => !/SELECT (id,name|name,email)/i.test(sql) && !/SELECT \* FROM lead_enquiry_revisions/i.test(sql)));
  assert.equal(Number((await db.get("SELECT count(*) n FROM audit_logs WHERE event_type='LeadDataExported'")).n), originalAudits);
});
test("selected export input preflight refuses aggregate oversized data before loading any lead values", async t => {
  const { db, leads, exporter } = await setup(t), ids = [];
  for (let index = 0; index < 2; index++) { const lead = await leads.createLead({ organization_id: "org", name: "Legacy", email: "aggregate" + index + "@example.test" }); ids.push(lead.id); await db.run("UPDATE leads SET name=? WHERE id=?", ["x".repeat(5 * 1024 * 1024), lead.id]); }
  const reads = observeReads(db);
  await assert.rejects(exporter.exportSelected(exportInput(ids)), { code: "LEAD_EXPORT_LIMIT", statusCode: 413 });
  assert.ok(reads.some(sql => sql.includes("AS identity_bytes"))); assert.ok(reads.every(sql => !/SELECT (id,name|name,email)/i.test(sql)));
  assert.equal(Number((await db.get("SELECT count(*) n FROM audit_logs WHERE event_type='LeadDataExported'")).n), 0);
});
