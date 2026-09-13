import { ContactPolicyRepository } from "./contactPolicyRepository.js";
import { canonicalContact, canonicalContactsForLead, recipientForLead, CONTACT_CHANNELS, RESTRICTION_REASONS, RESTRICTION_SOURCES, policyError } from "./contactPolicyContract.js";

const guardedWorkspaces = new WeakMap();
const observedFreshnessTimes = new WeakMap();

export function assertWorkspaceTransaction(tx, organizationId) {
  if (!tx?.transactionBound || guardedWorkspaces.get(tx) !== organizationId) {
    throw new Error("Contact policy requires the matching workspace transaction gate.");
  }
}

// Only the trusted evaluator can retain technical time after domain rollback.
// The workspace lock is acquired before the savepoint and survives its rollback.
export function recordWorkspaceFreshnessTime(tx, organizationId, at) {
  assertWorkspaceTransaction(tx, organizationId);
  if (typeof at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(at) || !Number.isFinite(Date.parse(at)) || new Date(at).toISOString() !== at) {
    throw Object.assign(new Error("Freshness clock requires operational review."), { code: "FRESHNESS_CLOCK_INVALID", statusCode: 503 });
  }
  const previous = observedFreshnessTimes.get(tx);
  if (!previous || at > previous) observedFreshnessTimes.set(tx, at);
}

export class ContactPolicyService {
  constructor(db) { this.db = db; }

  assertWorkspaceTransaction(tx, organizationId) { assertWorkspaceTransaction(tx, organizationId); }

  async withWorkspacePolicyTransaction(organizationId, work) {
    requireText(organizationId, "organization_id");
    if (typeof work !== "function") throw new TypeError("Workspace policy transaction requires a callback.");
    const outcome = await this.db.transaction(async (tx) => {
      if (tx.kind === "postgres") await tx.get("SELECT set_config('lock_timeout', '5000ms', true)");
      const row = await tx.get("SELECT id FROM organizations WHERE id = ?" + (tx.kind === "postgres" ? " FOR UPDATE" : ""), [organizationId]);
      if (!row) throw policyError(404, "Workspace not found.");
      guardedWorkspaces.set(tx, organizationId);
      try {
        await tx.run("SAVEPOINT workspace_domain_work");
        try {
          const value = await work(tx);
          await tx.run("RELEASE SAVEPOINT workspace_domain_work");
          return { value };
        } catch (error) {
          await tx.run("ROLLBACK TO SAVEPOINT workspace_domain_work");
          await tx.run("RELEASE SAVEPOINT workspace_domain_work");
          const at = observedFreshnessTimes.get(tx);
          if (at) {
            await tx.run(
              "INSERT INTO workspace_freshness_clocks(organization_id,high_water_at) VALUES (?,?) " +
              "ON CONFLICT(organization_id) DO UPDATE SET high_water_at=CASE WHEN excluded.high_water_at > workspace_freshness_clocks.high_water_at THEN excluded.high_water_at ELSE workspace_freshness_clocks.high_water_at END",
              [organizationId, at]
            );
          }
          return { error };
        }
      } finally {
        guardedWorkspaces.delete(tx);
        observedFreshnessTimes.delete(tx);
      }
    }, { lockTimeoutMs: 5000 });
    if (outcome.error) throw outcome.error;
    return outcome.value;
  }

  restrictLead(input) {
    return this.withWorkspacePolicyTransaction(input.organization_id, (tx) => this.restrictLeadInTransaction(tx, input));
  }

  restrictContact(input) {
    return this.withWorkspacePolicyTransaction(input.organization_id, (tx) => this.restrictContactInTransaction(tx, input));
  }

  async restrictLeadInTransaction(tx, input) {
    const validated = validateRestriction(input);
    assertWorkspaceTransaction(tx, validated.organization_id);
    requireText(validated.lead_id, "lead_id");
    const repository = new ContactPolicyRepository(tx);
    const lead = await repository.getLead(validated.organization_id, validated.lead_id);
    if (!lead) throw policyError(404, "Lead not found for workspace.");
    const contacts = canonicalContactsForLead(lead).filter((contact) =>
      contact.kind === "LEAD" || validated.channel === "ALL" ||
      (validated.channel === "EMAIL" ? contact.kind === "EMAIL" : contact.kind === "PHONE"));
    const result = await this.#restrict(tx, validated, contacts);
    if (validated.channel === "ALL" && ["OPT_OUT", "SUPPRESSED"].includes(validated.reason)) {
      await tx.run(
        "UPDATE leads SET status = CASE WHEN status = 'SUPPRESSED' OR ? = 'SUPPRESSED' THEN 'SUPPRESSED' ELSE 'OPTED_OUT' END, updated_at = ? WHERE organization_id = ? AND id = ?",
        [validated.reason, new Date().toISOString(), validated.organization_id, validated.lead_id]
      );
    }
    return result;
  }

  async restrictContactInTransaction(tx, input) {
    const validated = validateRestriction(input);
    assertWorkspaceTransaction(tx, validated.organization_id);
    const contact = canonicalContact(input.contact?.kind, input.contact?.value);
    if (!contact || !["EMAIL", "PHONE"].includes(contact.kind)) throw policyError(400, "A valid normalized email or international phone contact is required.");
    if (validated.channel !== "ALL" && (contact.kind === "EMAIL" ? validated.channel !== "EMAIL" : validated.channel === "EMAIL")) {
      throw policyError(400, "Contact kind and restriction channel do not match.");
    }
    if (validated.lead_id && !await new ContactPolicyRepository(tx).getLead(validated.organization_id, validated.lead_id)) {
      throw policyError(404, "Lead not found for workspace.");
    }
    return this.#restrict(tx, validated, [contact]);
  }

  async #restrict(tx, input, contacts) {
    const repository = new ContactPolicyRepository(tx);
    const inserted = [];
    for (const contact of contacts) inserted.push(await repository.append(input, contact));
    const restrictions = inserted.map((result) => result.restriction);
    const effects = await repository.cancelApplicableWork(input.organization_id, restrictions);
    await repository.recordAudit(input, restrictions, effects);
    return { restrictions, ...effects, duplicate: inserted.every((result) => !result.inserted) };
  }

  inspectLead(input) { return this.#inspect(this.db, input); }

  inspectLeadInTransaction(tx, input) {
    assertWorkspaceTransaction(tx, input.organization_id);
    return this.#inspect(tx, input);
  }

  async #inspect(db, { organization_id, lead_id, channel = "ALL", recipient = null }) {
    requireText(organization_id, "organization_id");
    requireText(lead_id, "lead_id");
    if (channel !== "ALL" && !CONTACT_CHANNELS.includes(channel)) throw policyError(400, "Contact channel is invalid.");
    const repository = new ContactPolicyRepository(db);
    const lead = await repository.getLead(organization_id, lead_id);
    if (!lead) throw policyError(404, "Lead not found for workspace.");
    const supplied = recipient ? canonicalContact(recipient.kind, recipient.value) : null;
    const expectedKind = channel === "EMAIL" ? "EMAIL" : "PHONE";
    const contact = recipient ? supplied : recipientForLead(lead, channel);
    const unresolved = channel !== "ALL" && (!contact || contact.kind !== expectedKind);
    const identities = canonicalContactsForLead(lead);
    const scopes = [...identities, ...(contact && !unresolved && !identities.some((identity) => identity.kind === contact.kind && identity.value === contact.value) ? [contact] : [])];
    const candidates = await repository.restrictionsFor(organization_id, scopes, channel);
    // An ALL restriction on any directly shared identity blocks this lead,
    // but does not create restrictions for its other identities or neighbors.
    const restrictions = candidates.filter((restriction) => channel === "ALL" || restriction.channel === "ALL" ||
      restriction.contact_kind === "LEAD" ||
      (contact && restriction.contact_kind === contact.kind && restriction.contact_value === contact.value));
    const legacyRestricted = ["OPTED_OUT", "SUPPRESSED"].includes(lead.status);
    // Receipt admission and dispatch both use the workspace gate. Until policy
    // has been resolved, its contact scope may be unknown; defer every send in
    // this workspace without turning a temporary hold into a consent decision.
    const policyPending = Boolean(await db.get(
      "SELECT id FROM webhook_receipts WHERE organization_id = ? AND mandatory_policy_status = 'PENDING' LIMIT 1",
      [organization_id]
    ));
    return {
      restricted: restrictions.length > 0 || legacyRestricted || unresolved,
      policy_pending: policyPending,
      reason: restrictions.length || legacyRestricted ? "CONTACT_RESTRICTED" : unresolved ? "CONTACT_UNRESOLVED" : policyPending ? "CONTACT_POLICY_PENDING" : null,
      contact,
      restriction_ids: restrictions.map((restriction) => restriction.id)
    };
  }
}

function requireText(value, name) {
  if (typeof value !== "string" || !value.trim() || value.length > 500) throw policyError(400, name + " is required and must be at most 500 characters.");
}

function validateRestriction(input) {
  const result = { ...input, channel: input.channel || "ALL" };
  requireText(result.organization_id, "organization_id");
  requireText(result.source_event_id, "source_event_id");
  if (!RESTRICTION_REASONS.includes(result.reason)) throw policyError(400, "Restriction reason is invalid.");
  if (!RESTRICTION_SOURCES.includes(result.source)) throw policyError(400, "Restriction source is invalid.");
  if (result.channel !== "ALL" && !CONTACT_CHANNELS.includes(result.channel)) throw policyError(400, "Restriction channel is invalid.");
  if (result.actor_id != null) requireText(result.actor_id, "actor_id");
  if (result.effective_at != null && (typeof result.effective_at !== "string" || !Number.isFinite(Date.parse(result.effective_at)))) {
    throw policyError(400, "Restriction effective_at is invalid.");
  }
  return result;
}
