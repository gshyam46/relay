import { createDatabase } from "../../src/database/database.js";
import { LeadsRepository } from "../../src/modules/data-foundation/leadsRepository.js";
import { ContactPolicyService } from "../../src/modules/contact-policy/contactPolicyService.js";
import { ChannelWorkflowService } from "../../src/modules/channels/channelWorkflowService.js";
import { LocalReplyClassifier } from "../../src/modules/channels/replyClassifier.js";
import { ChannelMessagesRepository } from "../../src/modules/channels/channelMessagesRepository.js";
import { InboundEventsRepository } from "../../src/modules/channels/inboundEventsRepository.js";
import { FollowUpsRepository } from "../../src/modules/channels/followUpsRepository.js";
import { ActionsRepository } from "../../src/modules/outbound-automation/actionsRepository.js";
import { ExecutionsRepository } from "../../src/modules/outbound-automation/executionsRepository.js";
import { PreparedActionService } from "../../src/modules/outbound-automation/preparedActionService.js";
import { CallbacksRepository } from "../../src/modules/outbound-automation/callbacksRepository.js";
import { CallbacksService } from "../../src/modules/outbound-automation/callbacksService.js";
import { EventsRepository } from "../../src/modules/events/eventsRepository.js";
import { AuditRepository } from "../../src/modules/events/auditRepository.js";
import { WebhookInboxService } from "../../src/modules/webhook-inbox/webhookInboxService.js";
import { applySendgridEvent } from "../../src/modules/channels/sendgridEvents.js";

export async function callbackFixture(t) {
  let clock = Date.now();
  const now = () => clock;
  const advance = (ms) => { clock += ms; };
  const db = await createDatabase(":memory:");
  t.after(() => db.close());
  const leadsRepository = new LeadsRepository(db);
  const organization = await leadsRepository.createOrganization({ name: "Inbound policy fixture" });
  const otherOrganization = await leadsRepository.createOrganization({ name: "Other policy fixture" });
  const createLead = (email = "person@example.com", organization_id = organization.id) =>
    leadsRepository.createLead({ organization_id, name: "Synthetic contact", email, phone: "+14155550123" });
  const lead = await createLead();
  const contactPolicyService = new ContactPolicyService(db);
  const actionsRepository = new ActionsRepository(db);
  const executionsRepository = new ExecutionsRepository(db);
  const callbacksRepository = new CallbacksRepository(db);
  const channelMessagesRepository = new ChannelMessagesRepository(db);
  const inboundEventsRepository = new InboundEventsRepository(db);
  const followUpsRepository = new FollowUpsRepository(db);
  const eventsRepository = new EventsRepository(db);
  const auditRepository = new AuditRepository(db);
  const channelWorkflowService = new ChannelWorkflowService({
    leadsRepository, actionsRepository, channelMessagesRepository, inboundEventsRepository,
    followUpsRepository, eventsRepository, auditRepository, contactPolicyService,
    replyClassifier: new LocalReplyClassifier()
  });
  const callbacksService = new CallbacksService({
    callbacksRepository, actionsRepository, executionsRepository, leadsRepository,
    eventsRepository, auditRepository, channelWorkflowService, now
  });
  const services = { leadsRepository, contactPolicyService, actionsRepository, executionsRepository,
    callbacksRepository, channelMessagesRepository, inboundEventsRepository, followUpsRepository,
    eventsRepository, auditRepository, channelWorkflowService, callbacksService };
  const webhookInbox = new WebhookInboxService({ db, contactPolicyService, now, random: () => 1,
    handlers: {
      EXECUTION_CALLBACK: (input, context) => callbacksService.applyExecutionCallback(input, context),
      INBOUND_MESSAGE: (input, context) => channelWorkflowService.inboundMessageService.applyInboundMessage(input, context),
      SENDGRID_EVENT: (input, context) => applySendgridEvent(services, context.receipt.organization_id, input, context)
    }
  });
  callbacksService.webhookInbox = webhookInbox;
  channelWorkflowService.webhookInbox = webhookInbox;
  channelWorkflowService.inboundMessageService.webhookInbox = webhookInbox;
  services.webhookInbox = webhookInbox;
  let actionCount = 0;
  const createAction = (target = lead, type = "SEND_EMAIL") => actionsRepository.createAction({
    organization_id: target.organization_id, lead_id: target.id, type,
    idempotency_key: "inbound-fixture-action-" + (++actionCount), status: "APPROVED",
    payload: { subject: "Synthetic reviewed subject", body: "Synthetic reviewed message" }
  });
  const createAttempt = (action, { provider = "sendgrid", outcome_class = "ACCEPTED", newRevision = false } = {}) =>
    contactPolicyService.withWorkspacePolicyTransaction(action.organization_id, async (tx) => {
      const actions = new ActionsRepository(tx);
      const executions = new ExecutionsRepository(tx);
      const current = await actions.getActionForOrganization(action.id, action.organization_id);
      const reviewable = { ...current, status: "APPROVED" };
      const prepared = new PreparedActionService(tx);
      const existing = await prepared.repository.current(reviewable);
      const revision = await prepared.prepare(reviewable, newRevision && existing
        ? { forceNew: true, expected_revision_id: existing.id } : {});
      const attempt = await executions.nextAttempt(action.id);
      const execution = await executions.createExecution({
        action_id: action.id, status: ["DELIVERED"].includes(outcome_class) ? "COMPLETED"
          : ["DELIVERY_FAILED", "CLOSED_UNRESOLVED"].includes(outcome_class) ? "FAILED" : "STARTED",
        attempt, provider, started_at: new Date(now()).toISOString(), dispatch_authorized_at: new Date(now()).toISOString(), idempotency_key: action.id + ":fixture-attempt:" + attempt,
        action_revision_id: revision.id, envelope_hash: revision.content_hash, fence_token: attempt,
        outcome_class, lease_owner: "fixture", lease_expires_at: "2020-01-01T00:00:00.000Z"
      });
      await tx.run("UPDATE actions SET active_execution_id = ?, execution_fence = ?, status = 'EXECUTING' WHERE id = ?",
        [execution.id, execution.fence_token, action.id]);
      return execution;
    });
  const inbound = (overrides = {}) => channelWorkflowService.receiveInboundEvent({
    organization_id: organization.id, lead_id: lead.id, channel: "EMAIL", provider: "fixture-provider",
    provider_event_id: "inbound-1", payload: { text: "Please stop contacting me." }, ...overrides
  });
  const inspect = (target = lead, channel = "EMAIL") => contactPolicyService.inspectLead({
    organization_id: target.organization_id, lead_id: target.id, channel
  });
  return { db, organization, otherOrganization, lead, createLead, createAction, createAttempt, inbound, inspect, now, advance, ...services };
}
