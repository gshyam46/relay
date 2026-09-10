// Functional verification of every major workflow against a RUNNING server.
//
//   npm run dev:e2e            # in one terminal (port 3100, its own database)
//   npm run verify:workflows   # in another
//
// Or point it anywhere, including staging:
//   VERIFY_BASE_URL=https://relay-staging.onrender.com npm run verify:workflows
//
// This drives the product over HTTP exactly as the browser does, through the
// session auth gate, and covers what unit tests cannot: that the whole chain
// works together against a real server and a real database. It creates its own
// workspace with a timestamped email, so it is safe to run repeatedly against
// the same database and never touches existing data.
//
// It complements `npm test` rather than replacing it: a few intermediate states
// (a recommendation being momentarily stale before the worker rebuilds it) are
// only deterministic with the background worker disabled, and are asserted in
// the unit suite instead.
const BASE = process.env.VERIFY_BASE_URL || "http://127.0.0.1:3100";
const results = [];
let cookie = null;
let failures = 0;

function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` -- ${detail}` : ""}`);
}

async function req(path, opts = {}, session = true) {
  const headers = {
    "content-type": "application/json",
    ...(session && cookie ? { cookie: `relay_session=${cookie}` } : {})
  };
  const r = await fetch(BASE + path, { ...opts, headers });
  const set = r.headers.get("set-cookie");
  if (set) {
    const m = /relay_session=([^;]+)/.exec(set);
    if (m) cookie = m[1];
  }
  const body = await r.text();
  let json = null;
  try {
    json = JSON.parse(body);
  } catch {
    /* non-json response */
  }
  return { status: r.status, json, body, headers: r.headers };
}
const post = (p, b, session = true) => req(p, { method: "POST", body: JSON.stringify(b) }, session);
const get = (p, session = true) => req(p, {}, session);
const put = (p, b) => req(p, { method: "PUT", body: JSON.stringify(b) });

// ------------------------------------------------------------------ health
check("liveness /api/health/live", (await get("/api/health/live", false)).json?.check === "live");
const ready = await get("/api/health/ready", false);
check(
  "readiness reports ready with no pending migrations",
  ready.json?.status === "ready" && ready.json?.migrations?.pending?.length === 0
);

// ------------------------------------------------------------------ auth gate
check("unauthenticated API access is refused", (await get("/api/leads", false)).status === 401);

// ------------------------------------------------------------------ signup / login
const suffix = Date.now();
const email = `verify-${suffix}@test.relay.local`;
const reg = await post(
  "/api/auth/register",
  {
    organization_name: `Verify Co ${suffix}`,
    name: "Verifier",
    email,
    password: "correct-horse-battery-staple"
  },
  false
);
check("signup creates a workspace and a session", reg.status === 201 && !!reg.json?.organization?.id);
const org = reg.json.organization.id;
check("session cookie is HttpOnly", /HttpOnly/i.test(reg.headers.get("set-cookie") || ""));
check("authenticated /api/auth/me works", (await get("/api/auth/me")).json?.organization?.id === org);
check("wrong password is rejected", (await post("/api/auth/login", { email, password: "wrong" }, false)).status === 401);
check(
  "login with the right password works",
  (await post("/api/auth/login", { email, password: "correct-horse-battery-staple" }, false)).status === 200
);

// ------------------------------------------------------------------ CSV import
const csv = [
  "Name,Email,Phone,Company",
  "Aarav Kapoor,aarav@example.com,+91 90000 11111,Kapoor Homes",
  "Meera Joshi,meera@example.com,+91 90000 22222,Joshi Interiors",
  "Rohan Das,rohan@example.com,+91 90000 33333,Das Living",
  "Bad Row,not-an-email,,No Contact Co"
].join("\n");
const preview = await post("/api/imports/csv/preview", {
  organization_id: org,
  filename: "verify.csv",
  csv_text: csv,
  default_phone_region: "INTERNATIONAL_ONLY"
});
check("CSV preview parses every data row", preview.status === 201 && preview.json.rows.length === 4, `${preview.json?.rows?.length} rows`);
const validRows = preview.json.rows.filter((r) => r.validation_state === "VALID");
check("CSV preview marks the malformed row invalid", validRows.length === 3, `${validRows.length} valid`);
const committed = await post(`/api/imports/${preview.json.import.id}/commit`, {
  organization_id: org,
  selected_row_ids: validRows.map((r) => r.id)
});
// The commit response echoes every row in the import, so only the selected ones
// are expected to have become leads.
const selectedIds = new Set(validRows.map((r) => r.id));
const createdRows = committed.json.rows.filter((r) => selectedIds.has(r.id));
check(
  "CSV commit creates a lead for each valid row and none for the invalid one",
  committed.status === 200 && createdRows.length === 3 && createdRows.every((r) => r.created_lead_id) &&
    committed.json.rows.filter((r) => !selectedIds.has(r.id)).every((r) => !r.created_lead_id),
  `${createdRows.length} created`
);
const dupPreview = await post("/api/imports/csv/preview", {
  organization_id: org,
  filename: "verify-dup.csv",
  csv_text: "Name,Email\nAarav Kapoor,aarav@example.com",
  default_phone_region: "INTERNATIONAL_ONLY"
});
check("re-importing a known email is flagged as a duplicate", (dupPreview.json.rows[0].duplicate_candidates || []).length > 0);

// ------------------------------------------------------------------ intelligence
await post("/api/worker/run", { organization_id: org });
const summaryBefore = await get(`/api/intelligence/summary?organization_id=${org}`);
check(
  "intelligence summary reports leads needing analysis",
  summaryBefore.json.totals.eligible_for_analysis > 0,
  `${summaryBefore.json.totals.eligible_for_analysis} eligible`
);
check(
  "eligibility ids match the advertised count",
  summaryBefore.json.eligible_lead_ids.length === summaryBefore.json.totals.eligible_for_analysis
);

const bulk = await post("/api/intelligence/bulk-run", { organization_id: org });
check(
  "bulk intelligence run processes every eligible lead",
  bulk.json.succeeded === bulk.json.processed && bulk.json.failed === 0,
  `${bulk.json.succeeded}/${bulk.json.processed}`
);
const summaryAfter = await get(`/api/intelligence/summary?organization_id=${org}`);
check("nothing remains eligible after a bulk run", summaryAfter.json.totals.eligible_for_analysis === 0);
check(
  "every lead now has a recommendation",
  summaryAfter.json.totals.with_recommendation === summaryAfter.json.totals.total,
  `${summaryAfter.json.totals.with_recommendation}/${summaryAfter.json.totals.total}`
);
check("running bulk again is a no-op", (await post("/api/intelligence/bulk-run", { organization_id: org })).json.processed === 0);

const leads = (await get(`/api/leads?organization_id=${org}`)).json.leads;
const lead = leads[0];
const intel = await get(`/api/leads/${lead.id}/intelligence?organization_id=${org}`);
check(
  "lead intelligence is evidence-grounded",
  (intel.json.intelligence?.evidence || []).length > 0,
  `${intel.json.intelligence?.evidence?.length} evidence items`
);
check(
  "synthesis, recommendation and next action are all ready",
  intel.json.synthesis_status === "READY" &&
    intel.json.recommendation_status === "READY" &&
    intel.json.next_best_action_status === "PLANNED"
);

// ------------------------------------------------------------------ outbound
const outbound = await get(`/api/outbound/summary?organization_id=${org}`);
const pending = outbound.json.actions.filter((a) => a.status === "AWAITING_APPROVAL");
check("analysed leads produce approval-gated outbound actions", pending.length > 0, `${pending.length} awaiting review`);
const emailAction = pending.find((a) => a.type === "SEND_EMAIL");
check(
  "the action carries customer-facing copy, not internal reasoning",
  !!emailAction?.payload?.message && !/evidence-backed intelligence|outbound review/i.test(emailAction.payload.message)
);
check(
  "the action has a real subject distinct from the body",
  !!emailAction?.payload?.subject && emailAction.payload.subject !== emailAction.payload.message
);

const rejectTarget = pending[pending.length - 1];
check(
  "an action can be rejected",
  (await post("/api/actions/bulk-reject", { organization_id: org, action_ids: [rejectTarget.action_id] })).json.rejected === 1
);
const approveIds = pending.filter((a) => a.action_id !== rejectTarget.action_id).map((a) => a.action_id);
check(
  "bulk approve moves a batch through",
  (await post("/api/actions/bulk-approve", { organization_id: org, action_ids: approveIds })).json.approved === approveIds.length
);
check(
  "bulk execute sends the approved batch",
  (await post("/api/actions/bulk-execute", { organization_id: org, action_ids: approveIds })).json.executed === approveIds.length
);
await post("/api/worker/run", { organization_id: org });

// Sandbox channels have no real provider to send a delivery webhook, so the
// server simulates one on its background interval — deliberately NOT inside
// POST /api/worker/run, which keeps a narrower meaning for every other caller.
// So this waits for that tick rather than assuming it has already happened;
// asserting immediately made this fail on PostgreSQL and pass on SQLite purely
// because of timing.
let afterSend = await get(`/api/outbound/summary?organization_id=${org}`);
for (let attempt = 0; attempt < 8 && !(afterSend.json.totals.by_status.COMPLETED > 0); attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  afterSend = await get(`/api/outbound/summary?organization_id=${org}`);
}
check(
  "sent actions reach a terminal completed state",
  (afterSend.json.totals.by_status.COMPLETED || 0) > 0,
  JSON.stringify(afterSend.json.totals.by_status)
);

// ------------------------------------------------------------------ email config safety
check(
  "email channel defaults to sandbox",
  (await get(`/api/settings/channels/test?organization_id=${org}&channel=email`)).json.status === "sandbox"
);
await put("/api/settings", {
  organization_id: org,
  category: "channel_email",
  values: { provider: "resend", api_key: "re_verify_secret", from_email: "hello@verify.test" }
});
const settings = await get(`/api/settings?organization_id=${org}`);
check("provider credentials are masked on read", settings.json.settings.channel_email.api_key === "********");
check("credentials never appear anywhere in the response", !settings.body.includes("re_verify_secret"));
check("the UI can still tell the key is set", settings.json.settings.channel_email.api_key_configured === true);
await put("/api/settings", { organization_id: org, category: "channel_email", values: { provider: "sandbox", api_key: "" } });
check(
  "resetting to sandbox works",
  (await get(`/api/settings/channels/test?organization_id=${org}&channel=email`)).json.status === "sandbox"
);

// ------------------------------------------------------------------ inbound replies
const [q, neg, junk] = leads;
const question = await post("/api/inbound-events/mock", {
  organization_id: org,
  lead_id: q.id,
  channel: "EMAIL",
  provider_event_id: `v-q-${suffix}`,
  payload: { text: "How much would a full fit-out cost?" }
});
check("an inbound question is classified", question.json.classification.event_type === "QUESTION");
check("a follow-up is scheduled from the reply", !!question.json.follow_up);
check(
  "redelivery of the same reply is idempotent",
  (
    await post("/api/inbound-events/mock", {
      organization_id: org,
      lead_id: q.id,
      channel: "EMAIL",
      provider_event_id: `v-q-${suffix}`,
      payload: { text: "How much would a full fit-out cost?" }
    })
  ).json.duplicate === true
);

const lowConf = await post("/api/inbound-events/mock", {
  organization_id: org,
  lead_id: junk.id,
  channel: "EMAIL",
  provider_event_id: `v-junk-${suffix}`,
  payload: { text: "zzz qwerty" }
});
check("an unclassifiable reply is LOW confidence", lowConf.json.classification.confidence === "LOW");
// `escalated` is stored as an integer flag, so this is a truthiness check.
check("a low-confidence reply escalates for human review", !!lowConf.json.follow_up?.escalated);

const timeline = await get(`/api/leads/${q.id}/timeline?organization_id=${org}`);
const inboundMsg = timeline.json.timeline.find((e) => e.kind === "message" && e.direction === "INBOUND");
check(
  "the conversation shows what the lead actually said",
  inboundMsg.message === "How much would a full fit-out cost?",
  inboundMsg.message
);
check("our own classification is still available separately", /Classified as/.test(inboundMsg.summary || ""));

// This server runs the interval worker, so LeadReplyReceived may already have
// been processed by the time we look — the intermediate "stale" state is
// deterministic only with the worker disabled, and is asserted in
// test/reply-intelligence.test.js. Here we assert the end state, which is what a
// user sees: the recommendation reflects the reply.
await post("/api/worker/run", { organization_id: org });
const afterRec = (await get(`/api/leads/${q.id}/intelligence?organization_id=${org}`)).json;
check("the recommendation is current again after a reply", afterRec.recommendation_status === "READY");
check(
  "the reply is folded into the lead's intelligence as a signal",
  (afterRec.intelligence?.signals || []).some((s) => s.type === "LEAD_ASKED_QUESTION"),
  (afterRec.intelligence?.signals || []).map((s) => s.type).join(", ")
);

// ------------------------------------------------------------------ opt-out
const optOut = await post("/api/inbound-events/mock", {
  organization_id: org,
  lead_id: neg.id,
  channel: "EMAIL",
  provider_event_id: `v-opt-${suffix}`,
  payload: { text: "Please unsubscribe me" }
});
check(
  "an opt-out is classified with high confidence",
  optOut.json.classification.event_type === "OPT_OUT" && optOut.json.classification.confidence === "HIGH"
);
await post("/api/worker/run", { organization_id: org });
check("an opted-out lead is marked opted out", (await get(`/api/leads/${neg.id}?organization_id=${org}`)).json.lead.status === "OPTED_OUT");
check(
  "an opted-out lead gets no new planned action",
  (await get(`/api/leads/${neg.id}/intelligence?organization_id=${org}`)).json.next_best_action_status !== "PLANNED"
);

// ------------------------------------------------------------------ follow-ups
const followUps = await get(`/api/follow-ups?organization_id=${org}`);
check("follow-ups are listed", (followUps.json.follow_ups || []).length > 0, `${followUps.json.follow_ups?.length}`);
const openFollowUp = followUps.json.follow_ups.find((f) => f.status === "DUE" || f.status === "PLANNED");
check(
  "a follow-up can be completed",
  openFollowUp ? (await post(`/api/follow-ups/${openFollowUp.id}/complete`, { organization_id: org })).status === 200 : false
);

// ------------------------------------------------------------------ conversations / dashboard
check("channel messages are listed for the inbox", ((await get(`/api/channels/messages?organization_id=${org}`)).json.messages || []).length > 0);
const metrics = await get(`/api/dashboard/metrics?organization_id=${org}`);
check("dashboard totals are numbers, not strings", typeof metrics.json.leads.total === "number");
check("dashboard lead total matches the lead list", metrics.json.leads.total === leads.length, `${metrics.json.leads.total} vs ${leads.length}`);
check("the attention queue surfaces work", Array.isArray((await get(`/api/dashboard/attention?organization_id=${org}`)).json.items));
check("activity feed is populated", ((await get(`/api/activity/feed?organization_id=${org}`)).json.events || []).length > 0);

// ------------------------------------------------------------------ tenant isolation
const other = await post(
  "/api/auth/register",
  {
    organization_name: `Other Co ${suffix}`,
    name: "Other",
    email: `other-${suffix}@test.relay.local`,
    password: "correct-horse-battery-staple"
  },
  false
);
const otherOrg = other.json.organization.id;
const crossLead = await get(`/api/leads/${lead.id}?organization_id=${org}`);
check("a different tenant cannot read another workspace's lead", crossLead.status === 403 || crossLead.status === 404, `status ${crossLead.status}`);
check("a different tenant sees only its own leads", (await get(`/api/leads?organization_id=${otherOrg}`)).json.leads.length === 0);
check(
  "a different tenant cannot analyse another workspace's lead",
  (await post("/api/intelligence/bulk-run", { organization_id: otherOrg, lead_ids: [lead.id] })).json.failed === 1
);
check(
  "a different tenant cannot approve another workspace's action",
  (await post("/api/actions/bulk-approve", { organization_id: otherOrg, action_ids: [rejectTarget.action_id] })).json.failed === 1
);

console.log(`\n${results.length - failures}/${results.length} checks passed`);
if (failures > 0) {
  console.log("\nFailures:");
  for (const r of results.filter((x) => !x.ok)) console.log(`  - ${r.name}${r.detail ? ` (${r.detail})` : ""}`);
}
process.exit(failures === 0 ? 0 : 1);
