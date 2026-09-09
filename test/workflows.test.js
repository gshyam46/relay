import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startClient } from "./helpers/testClient.js";

test("campaign sequence enrollment is idempotent for multiple leads", async (t) => {
  const client = await startClient(t);
  const { organization, sequence, leads } = await createSequenceFixture(client, {
    organizationName: "M6 Enrollment Org",
    steps: [{ type: "CREATE_HUMAN_TASK", title: "Review lead", delay_hours: 0 }]
  });

  const first = await client.post(`/api/sequences/${sequence.id}/enroll`, {
    organization_id: organization.id,
    lead_ids: leads.map((lead) => lead.id)
  });
  const second = await client.post(`/api/sequences/${sequence.id}/enroll`, {
    organization_id: organization.id,
    lead_ids: [leads[0].id, leads[0].id, leads[1].id]
  });
  const runs = await client.get(`/api/workflow-runs?organization_id=${organization.id}`);

  assert.equal(first.workflow_runs.length, 2);
  assert.deepEqual(
    first.workflow_runs.map((run) => run.id),
    second.workflow_runs.map((run) => run.id)
  );
  assert.equal(runs.workflow_runs.length, 2);
  assert.equal((await client.db.all("SELECT * FROM workflow_runs WHERE organization_id = ?", [organization.id])).length, 2);
});

test("due runner creates approval-gated sequence actions and continues after approval", async (t) => {
  const client = await startClient(t);
  const { organization, sequence, leads } = await createSequenceFixture(client, {
    organizationName: "M6 Approval Sequence Org",
    steps: [
      {
        type: "SEND_EMAIL",
        title: "Send intro",
        body: "Intro message",
        delay_hours: 0,
        requires_approval: true
      }
    ]
  });
  await client.post(`/api/sequences/${sequence.id}/enroll`, {
    organization_id: organization.id,
    lead_ids: [leads[0].id]
  });
  // Enrollment schedules the first step's due time from the real wall clock (nowIso()),
  // not from whatever due_at a caller later passes to run-due — so every due_at below has
  // to be anchored to real "now" at enrollment time, not a hardcoded calendar date that
  // will silently drift into the past the day after this test was written.
  const base = Date.now();

  const firstRun = await client.post("/api/workflows/run-due", {
    organization_id: organization.id,
    due_at: new Date(base).toISOString()
  });
  const action = await client.db.get("SELECT * FROM actions WHERE lead_id = ?", [leads[0].id]);
  const waitingRun = await client.get(`/api/workflow-runs?organization_id=${organization.id}`);
  await client.post(`/api/actions/${action.id}/approval/approve`, {
    organization_id: organization.id,
    reviewer_name: "Reviewer"
  });
  const secondRun = await client.post("/api/workflows/run-due", {
    organization_id: organization.id,
    due_at: new Date(base + 1000).toISOString()
  });
  const finalRun = await client.post("/api/workflows/run-due", {
    organization_id: organization.id,
    due_at: new Date(base + 2000).toISOString()
  });

  assert.equal(firstRun.processed_runs[0].status, "WAITING_APPROVAL");
  assert.equal(action.status, "AWAITING_APPROVAL");
  assert.equal(action.approval_requirement, "REQUIRED");
  assert.equal(waitingRun.workflow_runs[0].status, "WAITING_APPROVAL");
  assert.equal(secondRun.processed_runs[0].status, "WAITING");
  assert.equal((await client.db.all("SELECT * FROM action_executions WHERE action_id = ?", [action.id])).length, 1);
  assert.equal((await client.db.all("SELECT * FROM channel_messages WHERE action_id = ?", [action.id])).length, 1);
  assert.equal(finalRun.processed_runs[0].status, "COMPLETED");
});

test("wait steps delay later sequence actions until due", async (t) => {
  const client = await startClient(t);
  const { organization, sequence, leads } = await createSequenceFixture(client, {
    organizationName: "M6 Wait Org",
    steps: [
      { type: "WAIT", title: "Wait one hour", delay_hours: 1 },
      { type: "CREATE_HUMAN_TASK", title: "Check lead", delay_hours: 0 }
    ]
  });
  await client.post(`/api/sequences/${sequence.id}/enroll`, {
    organization_id: organization.id,
    lead_ids: [leads[0].id]
  });
  const base = Date.now();

  const first = await client.post("/api/workflows/run-due", {
    organization_id: organization.id,
    due_at: new Date(base).toISOString()
  });
  const early = await client.post("/api/workflows/run-due", {
    organization_id: organization.id,
    due_at: new Date(base + 30 * 60 * 1000).toISOString()
  });
  const due = await client.post("/api/workflows/run-due", {
    organization_id: organization.id,
    due_at: new Date(base + 60 * 60 * 1000).toISOString()
  });

  assert.equal(first.processed_runs[0].status, "WAITING");
  assert.equal(early.processed_runs.length, 0);
  assert.equal(due.processed_runs[0].status, "WAITING");
  assert.equal((await client.db.all("SELECT * FROM actions WHERE lead_id = ?", [leads[0].id])).length, 1);
});

test("inbound replies stop open workflow runs", async (t) => {
  const client = await startClient(t);
  const { organization, sequence, leads } = await createSequenceFixture(client, {
    organizationName: "M6 Stop Org",
    steps: [
      { type: "WAIT", title: "Wait before follow-up", delay_hours: 24 },
      { type: "SEND_EMAIL", title: "Follow up", delay_hours: 0 }
    ]
  });
  await client.post(`/api/sequences/${sequence.id}/enroll`, {
    organization_id: organization.id,
    lead_ids: [leads[0].id]
  });
  await client.post("/api/workflows/run-due", {
    organization_id: organization.id,
    due_at: new Date().toISOString()
  });

  await client.post("/api/inbound-events/mock", {
    organization_id: organization.id,
    lead_id: leads[0].id,
    channel: "EMAIL",
    provider_event_id: "m6-stop-positive",
    event_type: "POSITIVE_REPLY",
    payload: { text: "Interested" }
  });
  const runs = await client.get(`/api/workflow-runs?organization_id=${organization.id}`);

  assert.equal(runs.workflow_runs[0].status, "STOPPED");
  assert.match(runs.workflow_runs[0].stop_reason, /positively/i);
});

test("workflow APIs are organization scoped", async (t) => {
  const client = await startClient(t);
  const first = await createSequenceFixture(client, {
    organizationName: "M6 Tenant A",
    steps: [{ type: "CREATE_HUMAN_TASK", title: "Task" }]
  });
  await client.register("M6 Tenant B"); // switches the active session to org B

  const wrongSequence = await client.rawFetch(`/api/sequences/${first.sequence.id}/enroll`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ lead_ids: [first.leads[0].id] })
  });
  const wrongCampaignSequence = await client.rawFetch("/api/sequences", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      campaign_id: first.campaign.id,
      name: "Wrong",
      steps: [{ type: "CREATE_HUMAN_TASK" }]
    })
  });
  const wrongRuns = await client.get("/api/workflow-runs");

  assert.equal(wrongSequence.status, 404);
  assert.equal(wrongCampaignSequence.status, 404);
  assert.equal(wrongRuns.workflow_runs.length, 0);
});

test("workflow state survives restart", async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ai-lead-workflows-"));
  const databaseFile = path.join(tempDir, "app.db");
  let firstClient;
  let secondClient;

  try {
    firstClient = await startClient(t, databaseFile, { autoCleanup: false });
    const { organization, sequence, leads, user } = await createSequenceFixture(firstClient, {
      organizationName: "M6 Restart Org",
      steps: [{ type: "WAIT", title: "Wait", delay_hours: 1 }]
    });
    await firstClient.post(`/api/sequences/${sequence.id}/enroll`, {
      organization_id: organization.id,
      lead_ids: [leads[0].id]
    });
    await firstClient.post("/api/workflows/run-due", {
      organization_id: organization.id,
      due_at: new Date().toISOString()
    });
    await firstClient.stop();

    secondClient = await startClient(t, databaseFile, { autoCleanup: false });
    await secondClient.login(user.email);
    const campaigns = await secondClient.get(`/api/campaigns?organization_id=${organization.id}`);
    const sequences = await secondClient.get(`/api/sequences?organization_id=${organization.id}`);
    const runs = await secondClient.get(`/api/workflow-runs?organization_id=${organization.id}`);

    assert.equal(campaigns.campaigns.length, 1);
    assert.equal(sequences.sequences.length, 1);
    assert.equal(sequences.sequences[0].steps.length, 1);
    assert.equal(runs.workflow_runs[0].status, "WAITING");
  } finally {
    await firstClient?.stop();
    await secondClient?.stop();
    await rm(tempDir, { recursive: true, force: true });
  }
});

async function createSequenceFixture(client, { organizationName, steps }) {
  const registered = await client.register(organizationName);
  const organization = registered.organization;
  const firstLead = await client.post("/api/leads", {
    organization_id: organization.id,
    name: `${organizationName} Lead One`,
    email: `${organizationName.toLowerCase().replaceAll(" ", "-")}-1@example.com`
  });
  const secondLead = await client.post("/api/leads", {
    organization_id: organization.id,
    name: `${organizationName} Lead Two`,
    email: `${organizationName.toLowerCase().replaceAll(" ", "-")}-2@example.com`
  });
  const campaignResponse = await client.post("/api/campaigns", {
    organization_id: organization.id,
    name: `${organizationName} Campaign`,
    objective: "Validate sequence workflow."
  });
  const sequenceResponse = await client.post("/api/sequences", {
    organization_id: organization.id,
    campaign_id: campaignResponse.campaign.id,
    name: `${organizationName} Sequence`,
    steps
  });
  return {
    organization,
    user: registered.user,
    campaign: campaignResponse.campaign,
    sequence: sequenceResponse.sequence,
    leads: [firstLead.lead, secondLead.lead]
  };
}
