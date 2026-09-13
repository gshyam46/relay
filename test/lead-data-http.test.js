import test from "node:test";
import assert from "node:assert/strict";
import { startClient } from "./helpers/testClient.js";
import { AuditRepository } from "../src/modules/events/auditRepository.js";
import { parseCsv } from "../src/modules/data-foundation/csvParser.js";

const raw = (client, method, route, body) => client.rawFetch(route, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const dataPath = lead => "/api/leads/" + lead.id + "/data";
const archivePath = lead => "/api/leads/" + lead.id + "/archive";
const values = lead => ({ name: lead.name, email: lead.email ?? null, phone: lead.phone ?? null, company: lead.company ?? null });
async function setup(t) { const client = await startClient(t); return { client, ...await client.register("Lead data HTTP") }; }
async function create(client, overrides = {}) { return (await client.post("/api/leads", { name: "Asha", email: "asha@example.test", company: "Sample", ...overrides })).lead; }
async function reviewed(client, lead, revision, proposed) {
  const input = { expected_revision: revision, values: proposed, default_phone_region: "INTERNATIONAL_ONLY" };
  const preview = await client.post(dataPath(lead) + "/preview", input);
  return { preview, command: { ...input, review_token: preview.review_token, reason: "Owner confirmed the current contact details" } };
}

test("HTTP reviewed correction retains source and actor history, rejects stale decisions, and replays the original accepted command", async t => {
  const { client, user } = await setup(t), lead = await create(client);
  const initial = await client.get(dataPath(lead));
  assert.equal(initial.current.data_revision, 0);
  assert.equal(initial.history.changes.length, 0);
  const sources = await client.get("/api/leads/" + lead.id + "/import-sources");
  const first = await reviewed(client, lead, 0, { ...values(lead), name: "Asha corrected", email: "corrected@example.test" });
  assert.equal(first.preview.can_save, true);
  const saved = await client.put(dataPath(lead), first.command);
  assert.equal(saved.current.data_revision, 1);
  assert.equal(saved.change.created_by, user.id);
  assert.equal(saved.change.kind, "CORRECT");
  assert.equal(saved.change.before.values.email, lead.email);
  assert.equal(saved.change.after.values.email, "corrected@example.test");
  assert.equal(saved.current.field_provenance.email.change_id, saved.change.id);
  assert.equal(saved.current.field_provenance.company, null);
  assert.deepEqual(await client.get("/api/leads/" + lead.id + "/import-sources"), sources);
  assert.equal((await raw(client, "PUT", dataPath(lead), { ...first.command, reason: "Different intent" })).status, 409);
  const second = await reviewed(client, lead, 1, { ...values(lead), name: "Asha latest", email: "latest@example.test" });
  await client.put(dataPath(lead), second.command);
  const replay = await client.put(dataPath(lead), first.command);
  assert.equal(replay.replayed, true);
  assert.equal(replay.change.id, saved.change.id);
  assert.equal(replay.current.data_revision, 1);
  const current = await client.get(dataPath(lead) + "?limit=1");
  assert.equal(current.current.data_revision, 2);
  assert.equal(current.history.changes.length, 1);
  assert.equal(current.history.has_more, true);
  const older = await client.get(dataPath(lead) + "?before_revision=" + current.history.next_before_revision);
  assert.equal(older.history.changes[0].id, saved.change.id);
});

test("HTTP archive and restore retain opt-out, distinguish directory scope and exclude archived attention and work pickers", async t => {
  const { client } = await setup(t), lead = await create(client), other = await create(client, { name: "Other", email: "other@example.test" });
  await client.post("/api/leads/" + lead.id + "/contact-restrictions", { reason: "OPT_OUT", channel: "ALL", idempotency_key: "http-archive-policy" });
  const archived = await client.post(archivePath(lead), { expected_revision: 0, archived: true, reason: "This enquiry is no longer active" });
  assert.ok(archived.current.archived_at);
  assert.equal(archived.current.data_revision, 1);
  assert.deepEqual((await client.get("/api/leads")).leads.map(row => row.id), [other.id]);
  const directory = await client.get("/api/leads/directory?archive=ARCHIVED");
  assert.equal(directory.total, 1);
  assert.equal(directory.leads[0].id, lead.id);
  assert.equal(directory.leads[0].status, "OPTED_OUT");
  assert.equal((await client.get("/api/leads/directory?archive=ALL")).total, 2);
  const metrics = await client.get("/api/dashboard/metrics");
  assert.equal(Number(metrics.leads.total), 1);
  assert.equal(metrics.leads.archived_count, 1);
  assert.ok((await client.get("/api/dashboard/attention")).items.every(item => item.lead_id !== lead.id));
  const unavailable = await client.post(dataPath(lead) + "/preview", { expected_revision: 1, values: values(lead), default_phone_region: "INTERNATIONAL_ONLY" });
  assert.equal(unavailable.can_save, false);
  assert.equal(unavailable.unavailable_reason, "LEAD_ARCHIVED");
  assert.equal(unavailable.review_token, null);
  assert.equal((await raw(client, "PUT", dataPath(lead), { expected_revision: 1, values: values(lead), default_phone_region: "INTERNATIONAL_ONLY", review_token: "0".repeat(64), reason: "Cannot edit archived records" })).status, 409);
  const restored = await client.post(archivePath(lead), { expected_revision: 1, archived: false, reason: "Owner is ready to review this enquiry again" });
  assert.equal(restored.current.data_revision, 2);
  assert.equal(restored.current.archived_at, null);
  assert.equal((await client.get("/api/leads/" + lead.id)).lead.status, "OPTED_OUT");
  assert.equal((await client.get("/api/leads/" + lead.id + "/contact-policy?channel=EMAIL")).restricted, true);
});

test("HTTP directory pagination binds the filters and rejects invalid limits/cursors", async t => {
  const { client } = await setup(t);
  for (let index = 0; index < 3; index++) await create(client, { name: "Page " + index, email: "page" + index + "@example.test" });
  const first = await client.get("/api/leads/directory?search=Page&limit=2");
  assert.equal(first.total, 3); assert.equal(first.leads.length, 2); assert.equal(first.has_more, true);
  const second = await client.get("/api/leads/directory?search=Page&limit=2&cursor=" + encodeURIComponent(first.next_cursor));
  assert.equal(second.leads.length, 1);
  assert.equal(new Set([...first.leads, ...second.leads].map(lead => lead.id)).size, 3);
  assert.equal((await raw(client, "GET", "/api/leads/directory?search=Other&cursor=" + encodeURIComponent(first.next_cursor))).status, 400);
  for (const query of ["limit=0", "limit=101", "limit=2.5", "limit=2x", "archive=DELETED", "cursor=malformed"]) assert.equal((await raw(client, "GET", "/api/leads/directory?" + query)).status, 400);
});

test("HTTP selected CSV download has safe attachment metadata, exact scope and preserved canonical JSON", async t => {
  const { client } = await setup(t);
  const lead = await create(client, { name: "=HYPERLINK(\"bad\")", phone: "+919876543210", company: "01234567890123456789" });
  const other = await create(client, { name: "Not selected", email: "other@example.test" });
  const response = await raw(client, "POST", "/api/leads/export", { lead_ids: [lead.id] });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/csv; charset=utf-8");
  assert.equal(response.headers.get("content-disposition"), 'attachment; filename="leads-export.csv"');
  assert.equal(response.headers.get("x-export-record-count"), "1");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  const csv = await response.text();
  assert.equal(Buffer.byteLength(csv), Number(response.headers.get("content-length")));
  assert.ok(csv.endsWith("\r\n"));
  assert.ok(csv.includes('"text: =HYPERLINK(""bad"")"'));
  assert.ok(csv.includes('"text: +919876543210"'));
  assert.ok(csv.includes('"text: 01234567890123456789"'));
  assert.ok(!csv.includes(other.id));
  const parsed = parseCsv(csv);
  assert.equal(parsed.issues.length, 0);
  assert.equal(parsed.records.length, 1);
  const canonical = JSON.parse(parsed.records[0].rawRow.contact_json);
  assert.equal(canonical.name, lead.name);
  assert.equal(canonical.phone, lead.phone);
  assert.equal(canonical.company, lead.company);
  for (const lead_ids of [[], [lead.id, lead.id], [lead.id, "missing"], Array.from({ length: 1001 }, (_, i) => "id-" + i)]) {
    const failure = await raw(client, "POST", "/api/leads/export", { lead_ids });
    assert.ok(failure.status >= 400 && failure.status < 500);
    assert.match(failure.headers.get("content-type"), /application\/json/);
    assert.equal(failure.headers.get("content-disposition"), null);
  }
});

test("HTTP lead data commands reject forged actor/state, non-owner and foreign scope", async t => {
  const { client, organization, user } = await setup(t), lead = await create(client);
  const { command } = await reviewed(client, lead, 0, { ...values(lead), name: "Changed" });
  for (const extra of [{ actor: { id: user.id, role: "OWNER" } }, { archived_at: "now" }, { status: "ACTIVE" }, { approval: true }]) {
    assert.equal((await raw(client, "PUT", dataPath(lead), { ...command, ...extra })).status, 400);
  }
  assert.equal((await fetch(client.baseUrl + dataPath(lead))).status, 401);
  assert.equal((await fetch(client.baseUrl + "/api/leads/directory")).status, 401);
  await client.db.run("UPDATE users SET role='MEMBER' WHERE id=?", [user.id]);
  for (const [method, path, body] of [["PUT", dataPath(lead), command], ["POST", dataPath(lead) + "/preview", { expected_revision: 0, values: values(lead), default_phone_region: "INTERNATIONAL_ONLY" }], ["POST", archivePath(lead), { expected_revision: 0, archived: true, reason: "Archive" }], ["POST", "/api/leads/export", { lead_ids: [lead.id] }]]) assert.equal((await raw(client, method, path, body)).status, 403);
  await client.db.run("UPDATE users SET role='OWNER' WHERE id=?", [user.id]);
  await client.register("Another workspace");
  assert.equal((await raw(client, "GET", dataPath(lead) + "?organization_id=" + organization.id)).status, 404);
  assert.equal((await raw(client, "PUT", dataPath(lead), { ...command, organization_id: organization.id })).status, 404);
  assert.equal((await raw(client, "POST", "/api/leads/export", { organization_id: organization.id, lead_ids: [lead.id] })).status, 404);
  assert.equal((await client.get("/api/leads/directory?organization_id=" + organization.id)).total, 0);
});

test("HTTP manual lead creation rolls back lead and event when audit persistence fails", async t => {
  const { client } = await setup(t);
  const original = AuditRepository.prototype.record;
  AuditRepository.prototype.record = async function(input) {
    if (input.event_type === "LeadCreated") throw new Error("Synthetic audit persistence failure");
    return original.call(this, input);
  };
  try {
    const result = await raw(client, "POST", "/api/leads", { name: "Must roll back", email: "rollback@example.test" });
    assert.equal(result.status, 500);
    assert.equal(Number((await client.db.get("SELECT COUNT(*) AS n FROM leads")).n), 0);
    assert.equal(Number((await client.db.get("SELECT COUNT(*) AS n FROM domain_events")).n), 0);
  } finally { AuditRepository.prototype.record = original; }
  const lead = await create(client);
  assert.ok(lead.id);
  assert.equal(Number((await client.db.get("SELECT COUNT(*) AS n FROM leads")).n), 1);
  assert.equal(Number((await client.db.get("SELECT COUNT(*) AS n FROM domain_events")).n), 1);
});

test("HTTP manual creation rechecks owner under its write gate after an intervening role change", async t => {
  const { client, user } = await setup(t);
  const original = client.services.leadsRepository.getOrganization.bind(client.services.leadsRepository);
  client.services.leadsRepository.getOrganization = async function(id) {
    const organization = await original(id);
    await client.db.run("UPDATE users SET role='MEMBER' WHERE id=?", [user.id]);
    return organization;
  };
  const response = await raw(client, "POST", "/api/leads", { name: "Demoted owner", email: "demoted@example.test" });
  assert.equal(response.status, 403);
  assert.equal(Number((await client.db.get("SELECT COUNT(*) AS n FROM leads")).n), 0);
  assert.equal(Number((await client.db.get("SELECT COUNT(*) AS n FROM domain_events")).n), 0);
});
