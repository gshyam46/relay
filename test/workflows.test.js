import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../src/api/app.js";
import { createDatabase } from "../src/database/database.js";

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
  assert.equal(client.db.all("SELECT * FROM workflow_runs WHERE organization_id = ?", [organization.id]).length, 2);
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

  const firstRun = await client.post("/api/workflows/run-due", {
    organization_id: organization.id,
    due_at: "2026-09-08T00:00:00.000Z"
  });
  const action = client.db.get("SELECT * FROM actions WHERE lead_id = ?", [leads[0].id]);
  const waitingRun = await client.get(`/api/workflow-runs?organization_id=${organization.id}`);
  await client.post(`/api/actions/${action.id}/approval/approve`, {
    organization_id: organization.id,
    reviewer_name: "Reviewer"
  });
  const secondRun = await client.post("/api/workflows/run-due", {
    organization_id: organization.id,
    due_at: "2026-09-08T00:00:01.000Z"
  });
  const finalRun = await client.post("/api/workflows/run-due", {
    organization_id: organization.id,
    due_at: "2026-09-08T00:00:02.000Z"
  });

  assert.equal(firstRun.processed_runs[0].status, "WAITING_APPROVAL");
  assert.equal(action.status, "AWAITING_APPROVAL");
  assert.equal(action.approval_requirement, "REQUIRED");
  assert.equal(waitingRun.workflow_runs[0].status, "WAITING_APPROVAL");
  assert.equal(secondRun.processed_runs[0].status, "WAITING");
  assert.equal(client.db.all("SELECT * FROM action_executions WHERE action_id = ?", [action.id]).length, 1);
  assert.equal(client.db.all("SELECT * FROM channel_messages WHERE action_id = ?", [action.id]).length, 1);
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

  const first = await client.post("/api/workflows/run-due", {
    organization_id: organization.id,
    due_at: "2026-09-08T00:00:00.000Z"
  });
  const early = await client.post("/api/workflows/run-due", {
    organization_id: organization.id,
    due_at: "2026-09-08T00:30:00.000Z"
  });
  const due = await client.post("/api/workflows/run-due", {
    organization_id: organization.id,
    due_at: "2026-09-08T01:00:00.000Z"
  });

  assert.equal(first.processed_runs[0].status, "WAITING");
  assert.equal(early.processed_runs.length, 0);
  assert.equal(due.processed_runs[0].status, "WAITING");
  assert.equal(client.db.all("SELECT * FROM actions WHERE lead_id = ?", [leads[0].id]).length, 1);
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
    due_at: "2026-09-08T00:00:00.000Z"
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
  const secondOrg = await client.post("/api/organizations", { name: "M6 Tenant B" });

  const wrongSequence = await fetch(`${client.baseUrl}/api/sequences/${first.sequence.id}/enroll`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      organization_id: secondOrg.organization.id,
      lead_ids: [first.leads[0].id]
    })
  });
  const wrongCampaignSequence = await fetch(`${client.baseUrl}/api/sequences`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      organization_id: secondOrg.organization.id,
      campaign_id: first.campaign.id,
      name: "Wrong",
      steps: [{ type: "CREATE_HUMAN_TASK" }]
    })
  });
  const wrongRuns = await client.get(`/api/workflow-runs?organization_id=${secondOrg.organization.id}`);

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
    const { organization, sequence, leads } = await createSequenceFixture(firstClient, {
      organizationName: "M6 Restart Org",
      steps: [{ type: "WAIT", title: "Wait", delay_hours: 1 }]
    });
    await firstClient.post(`/api/sequences/${sequence.id}/enroll`, {
      organization_id: organization.id,
      lead_ids: [leads[0].id]
    });
    await firstClient.post("/api/workflows/run-due", {
      organization_id: organization.id,
      due_at: "2026-09-08T00:00:00.000Z"
    });
    await firstClient.stop();

    secondClient = await startClient(t, databaseFile, { autoCleanup: false });
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
  const organizationResponse = await client.post("/api/organizations", { name: organizationName });
  const organization = organizationResponse.organization;
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
    campaign: campaignResponse.campaign,
    sequence: sequenceResponse.sequence,
    leads: [firstLead.lead, secondLead.lead]
  };
}

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

