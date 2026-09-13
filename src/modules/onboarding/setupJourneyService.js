import { ContactPolicyService } from "../contact-policy/contactPolicyService.js";
import { BusinessContextRepository } from "../business-context/businessContextRepository.js";
import { EmailConnectionRepository } from "../channels/emailConnectionRepository.js";
import { assessEmailConfiguration } from "../channels/emailConnectionContract.js";
import { AccountSecurityRepository } from "../auth/accountSecurityRepository.js";
import { CustomerWorkflowService } from "../customer-workflow/customerWorkflowService.js";
import { CustomerWorkflowRepository, sqlBytes } from "../customer-workflow/customerWorkflowRepository.js";

const MAX_PROFILE_BYTES = 524288;
function failure(code, status = 503) { const error = new Error("Setup observations could not be verified."); error.code = code; error.statusCode = status; error.status = status; return error; }
function step(id, state, reason_code, details = {}) { return { id, state, reason_code, details }; }
async function observe(id, read) { try { return await read(); } catch { return step(id, "UNAVAILABLE", "SETUP_OBSERVATION_UNAVAILABLE"); } }
function integer(value) { const number = Number(value); if (!Number.isSafeInteger(number) || number < 0) throw failure("SETUP_STATE_INVALID"); return number; }
function instant(value) { if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw failure("SETUP_STATE_INVALID"); return value; }

// A guide to persisted work, never a replacement for freshness or send policy.
// Every dependency below reads only. In particular, do not call assessLead here:
// its documented technical freshness-clock mutation belongs to Intelligence.
export class SetupJourneyService {
  constructor(db, { now = Date.now } = {}) { this.db = db; this.now = now; this.policy = new ContactPolicyService(db); }
  async get({ organization_id, actor }) {
    if (typeof organization_id !== "string" || !organization_id || organization_id.length > 256 || !actor || typeof actor.id !== "string" || !actor.id || actor.id.length > 256 || actor.role !== "OWNER") throw failure("SETUP_OWNER_REQUIRED", 403);
    return this.policy.withWorkspacePolicyTransaction(organization_id, async tx => {
      if (!await tx.get("SELECT id FROM users WHERE organization_id=? AND id=? AND role='OWNER'", [organization_id, actor.id])) throw failure("SETUP_OWNER_REQUIRED", 403);
      const time = this.now(); if (!Number.isSafeInteger(time) || !Number.isFinite(new Date(time).getTime())) throw failure("SETUP_STATE_INVALID");
      const org = organization_id, steps = [];
      steps.push(await observe("BUSINESS", async () => {
        const bytes = await tx.get("SELECT " + sqlBytes(tx, "profile_json") + "+" + sqlBytes(tx, "fit_criteria_json") + " bytes FROM business_profile_revisions WHERE organization_id=? ORDER BY revision DESC LIMIT 1", [org]);
        if (bytes && integer(bytes.bytes) > MAX_PROFILE_BYTES) throw failure("SETUP_INPUT_LIMIT");
        const current = await new BusinessContextRepository(tx).current("profile", org), configured = Boolean(current.profile.business_name && current.profile.offerings.length), criteria_configured = current.fit_criteria !== null;
        return step("BUSINESS", !configured ? "NOT_STARTED" : criteria_configured ? "RECORDED" : "NEEDS_ATTENTION", !configured ? "BUSINESS_PROFILE_MISSING" : criteria_configured ? "BUSINESS_PROFILE_RECORDED" : "FIT_CRITERIA_MISSING", { revision: current.revision, configured, criteria_configured });
      }));
      let lead = null;
      const enquiry = await observe("ENQUIRY", async () => {
        lead = await tx.get("SELECT l.id,substr(l.name,1,200) name,l.status,l.archived_at,l.data_revision,substr(l.source,1,100) source FROM leads l WHERE l.organization_id=? AND l.archived_at IS NULL AND NOT EXISTS(SELECT 1 FROM email_verification_probes p WHERE p.organization_id=l.organization_id AND p.lead_id=l.id) ORDER BY l.created_at DESC,l.id DESC LIMIT 1", [org]);
        return step("ENQUIRY", lead ? "RECORDED" : "NOT_STARTED", lead ? "ENQUIRY_RECORDED" : "ENQUIRY_MISSING", lead ? { source: lead.source } : {});
      });
      steps.push(enquiry);
      steps.push(lead ? await observe("INTELLIGENCE", async () => {
        const saved = await tx.get("SELECT id,status,created_at FROM intelligence_snapshots WHERE organization_id=? AND lead_id=? ORDER BY created_at DESC,id DESC LIMIT 1", [org, lead.id]);
        return step("INTELLIGENCE", saved ? "NEEDS_ATTENTION" : "NOT_STARTED", saved ? "ASSESSMENT_CURRENTNESS_NOT_CHECKED" : "ASSESSMENT_MISSING", { currentness: "NOT_CHECKED", snapshot: saved ? { id: saved.id, status: saved.status, created_at: instant(saved.created_at) } : null });
      }) : step("INTELLIGENCE", enquiry.state === "UNAVAILABLE" ? "UNAVAILABLE" : "NOT_STARTED", enquiry.state === "UNAVAILABLE" ? "SETUP_OBSERVATION_UNAVAILABLE" : "SELECT_ENQUIRY_FIRST"));
      steps.push(await observe("CHANNEL", async () => {
        const config = await new EmailConnectionRepository(tx).settings(org), result = assessEmailConfiguration(config), provider = config.provider || "sandbox";
        if (typeof provider !== "string" || provider.length > 100) throw failure("SETUP_STATE_INVALID");
        return step("CHANNEL", "NEEDS_ATTENTION", provider === "sandbox" ? "SANDBOX_CHANNEL_ONLY" : result.complete ? "CHANNEL_VERIFICATION_NOT_CHECKED" : "CHANNEL_CONFIGURATION_INCOMPLETE", { provider, configuration_complete: result.complete, verification_status: "NOT_CHECKED", live_send_available: false });
      }));
      steps.push(await observe("RECOVERY", async () => {
        const repo = new AccountSecurityRepository(tx), state = await repo.state(org, actor.id), recovery = await repo.recovery(org, actor.id, state.recovery_generation, time);
        return step("RECOVERY", recovery.usable_count > 0 ? "RECORDED" : "NOT_STARTED", recovery.usable_count > 0 ? "RECOVERY_CODES_AVAILABLE" : "RECOVERY_CODES_MISSING", { generation: recovery.generation, usable_count: recovery.usable_count, expires_at: recovery.expires_at });
      }));
      steps.push(lead ? await observe("REVIEW", async () => {
        const action = await tx.get("SELECT a.id,a.status,a.current_revision_id,r.id revision_id,r.revision,d.decision,d.decided_at FROM actions a LEFT JOIN action_revisions r ON r.organization_id=a.organization_id AND r.action_id=a.id AND r.id=a.current_revision_id LEFT JOIN action_revision_decisions d ON d.organization_id=a.organization_id AND d.action_id=a.id AND d.action_revision_id=r.id AND d.reviewed_hash=r.content_hash WHERE a.organization_id=? AND a.lead_id=? AND a.type='SEND_EMAIL' ORDER BY a.created_at DESC,a.id DESC LIMIT 1", [org, lead.id]);
        if (action?.current_revision_id && !action.revision_id) throw failure("SETUP_STATE_INVALID");
        return step("REVIEW", !action ? "NOT_STARTED" : action.decision ? "RECORDED" : "NEEDS_ATTENTION", !action ? "MESSAGE_MISSING" : action.decision ? "EXACT_REVISION_DECISION_RECORDED" : "MESSAGE_REVIEW_REQUIRED", { action: action ? { id: action.id, status: action.status, revision_id: action.revision_id, revision: action.revision === null ? null : integer(action.revision), decision: action.decision, decided_at: action.decided_at } : null, dispatch_authorization: "NOT_CHECKED" });
      }) : step("REVIEW", enquiry.state === "UNAVAILABLE" ? "UNAVAILABLE" : "NOT_STARTED", enquiry.state === "UNAVAILABLE" ? "SETUP_OBSERVATION_UNAVAILABLE" : "SELECT_ENQUIRY_FIRST"));
      steps.push(lead ? await observe("WORKFLOW", async () => {
        const repo = new CustomerWorkflowRepository(tx), workflow = new CustomerWorkflowService(tx, { now: () => time }), { conversation } = await workflow.state(tx, org, lead, repo);
        const reminder = await tx.get("SELECT id,status,due_at FROM follow_up_tasks WHERE organization_id=? AND lead_id=? AND status IN('PLANNED','DUE','BLOCKED') AND idempotency_key LIKE 'manual-reminder:%' ORDER BY due_at,id LIMIT 1", [org, lead.id]);
        const rows = await tx.all("SELECT b.id,r.kind,r.occurred_at,r.revision FROM business_outcomes b JOIN business_outcome_revisions r ON r.organization_id=b.organization_id AND r.lead_id=b.lead_id AND r.outcome_id=b.id WHERE b.organization_id=? AND b.lead_id=? AND r.revision=(SELECT MAX(v.revision) FROM business_outcome_revisions v WHERE v.organization_id=b.organization_id AND v.outcome_id=b.id) AND r.status='RECORDED' ORDER BY r.created_at DESC,b.id DESC LIMIT 4", [org, lead.id]);
        const recorded = conversation.inbound_count > 0 || reminder || rows.length > 0, needs_attention = ["NEEDS_REPLY", "NEEDS_REVIEW", "ESCALATED", "CONTACT_UNRESOLVED", "CONTACT_RESTRICTED", "CONTACT_POLICY_PENDING"].includes(conversation.attention);
        return step("WORKFLOW", needs_attention ? "NEEDS_ATTENTION" : recorded ? "RECORDED" : "NOT_STARTED", needs_attention ? "CONVERSATION_ATTENTION_REQUIRED" : recorded ? "WORKFLOW_OBSERVATIONS_RECORDED" : "WORKFLOW_OBSERVATIONS_MISSING", { inbound_count: integer(conversation.inbound_count), conversation: { effective_status: conversation.effective_status, read_state: conversation.read_state, attention: conversation.attention }, pending_reminder: reminder ? { id: reminder.id, status: reminder.status, due_at: reminder.due_at } : null, outcomes: rows.slice(0, 3).map(row => ({ id: row.id, kind: row.kind, revision: integer(row.revision), occurred_at: instant(row.occurred_at) })), outcomes_truncated: rows.length > 3 });
      }) : step("WORKFLOW", enquiry.state === "UNAVAILABLE" ? "UNAVAILABLE" : "NOT_STARTED", enquiry.state === "UNAVAILABLE" ? "SETUP_OBSERVATION_UNAVAILABLE" : "SELECT_ENQUIRY_FIRST"));
      return { version: 1, assessed_at: new Date(time).toISOString(), scope: "LATEST_ACTIVE_ENQUIRY", lead: lead ? { id: lead.id, name: lead.name } : null, steps };
    });
  }
}
