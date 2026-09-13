# L1-04 and L1-08 Contact Policy and Reviewed Dispatch Contract

Product: **AI Lead Intelligence & Outbound Automation**.
Date: 2026-09-11.
Status: implementation contract for the user-authorized next slice; this document precedes dependent code. Acceptance remains separate.

## Smallest architecture change

Adopt the existing ADR-006/004 direction using L1-03 scoped units of work. Retain the modular monolith and SQL adapters. Add durable contact restrictions and immutable prepared review records. External network/model calls never run inside a database transaction.

Use a short transaction locking the tenant's organizations row before action rows: PostgreSQL FOR UPDATE, SQLite BEGIN IMMEDIATE. This is the initial serialization point shared by restriction writes, review decisions and dispatch authorization. It serializes safety decisions within a workspace; it does not lock across the provider request. Refine to narrower keys only from measured contention, preserving ordering.

## Restriction contract

ContactPolicyService(db) exposes withWorkspacePolicyTransaction(organizationId, work(tx)), restrictLead, restrictContact, their InTransaction variants, and inspectLead/inspectLeadInTransaction. Scoped writes/inspection validate the locked workspace. Inspection returns restricted/reason/contact/restriction_ids; absence of a restriction is not evidence of consent or a complete ALLOW policy.

Append-only records identify organization, LEAD/EMAIL/PHONE identity, exact normalized value, ALL or channel scope, reason, source, stable source_event_id, actor and times. Email is trimmed/lowercase and validated. Phone requires valid explicit international form; neither malformed stored normalization nor a guessed country establishes identity.

Explicit general opt-out records the lead and its current valid contacts with ALL scope. Provider unsubscribe/complaint/hard-bounce uses the actual authenticated event recipient and EMAIL scope; a missing action ID does not justify ignoring a valid recipient restriction. Group unsubscribe conservatively blocks EMAIL until group-aware sending is implemented. Temporary blocked delivery and unclassified bounce do not invent permanent consent revocation. Resubscribe tracking never clears restrictions; no re-consent endpoint is introduced in this slice.

Restriction writes cancel applicable queued SEND actions, follow-ups and workflows for exact matching tenant contacts in the same transaction. They leave completed/in-flight history intact. New imports/replies/duplicate records inherit effective restrictions by lookup; no graph-wide identity merge occurs. Unknown/shared identity can conservatively stop outreach and require human review.

Migration 0003 freezes the new schema and conservative historical backfill. Existing OPTED_OUT/SUPPRESSED and recorded historical opt-out remain restricted even if later status became ACTIVE. Where old provider events omitted the actual recipient, any conservative associated-lead backfill is explicitly marked legacy provenance and cannot claim to reconstruct a missing historical address.

## Inbound and provider boundary

Apply a locally explicit opt-out before optional model classification, even when a supplied event_type disagrees. Persist restrictions before ancillary message/follow-up work and repair compatible duplicate retries using canonical stored identity. Reject duplicate receipt identity conflicts; include provider in inbound message identity. Ordinary replies/delivery cannot clear restrictions or restart restricted follow-ups.

SendGrid events normalize documented top-level custom arguments plus the legacy nested fixture shape, refusing conflicting action IDs. Use actual event.email for recipient restrictions. Permanent hard bounce differs from temporary block. Unexpected/storage failures return a retryable response instead of acknowledging failed suppression.

Production provider routes require verification over original request bytes with configured signing keys. Workspace URL tokens resolve routing but do not replace signature verification. Explicit local test configuration may support synthetic fixtures; signed-path regressions must prove tamper/wrong-key/missing-key refusal. Live provider configuration and end-to-end evidence remain L4 gates.

## Prepared review and dispatch

The L1-08 consumer stores an immutable prepared envelope with normalized recipient, sender/provider identity, type/channel, rendered subject/body, relevant context/policy fingerprint and revision token. Secret configuration stays private; only an irreversible config fingerprint is stored, and the full captured credentials live in memory during dispatch. Credential/config changes conservatively require re-review.

Review exposes the prepared revision. Decisions require the expected revision token; edits first produce a new exact preview/revision. Prior decisions remain auditable. Revocation or changed content/recipient/sender/context cannot silently reuse approval, and legacy approval rows cannot grant approval to an unreviewed envelope. Unsafe normal manual placeholder sends stay disabled until the shared composer is available; normal external actions require review.

Revocation also applies to a confirmed safe RETRYING action. It preserves the original immutable decision and creates a fresh pending revision when possible. If current sender, recipient or content fails expected validation, revocation instead clears the current revision pointer and leaves a pending hold; repair and an explicit new preview are required before any new decision. Storage or internal errors roll back the complete revocation. EXECUTING actions cannot be recalled through review.

Dispatch reloads authoritative action/lead/config under the workspace gate, checks restrictions and the prepared revision, persists the STARTED attempt and EXECUTING authorization before invoking the provider, then releases the transaction. This narrow pre-send ownership step is necessary to define the suppression ordering point and prevent concurrent authorization. A second caller cannot send the same in-flight action. Broader L1-05 retry/deadline/lease/reconciliation and L1-06 scheduling remain explicit follow-on work.

If restriction commits first, dispatch cannot authorize. If authorization commits first, the request is treated as potentially in flight; later opt-out stops subsequent work without claiming recall. A process crash after authorization is conservatively held for reconciliation, not blindly reissued. Adapters consume the captured recipient/content/config snapshot without a later mutable lookup. Provider acceptance, delivery and response remain separate facts.

## Ownership and gates

- Root: shared API composition, dispatch integration, webhook verification/wiring, primary docs and integration evidence.
- Migration/contact-policy agent: new contact-policy module, immutable 0003 and focused fixtures.
- Review/adapter agent: prepared review records/0004, approval service, channel adapters/router and coordinated approval UI/tests.
- Inbound agent: inbound/callback lifecycle, provider event normalization and focused regressions.

Automated requirements: cross-tenant and duplicate-contact suppression; historical upgrade/restart; opt-out before/after approval/dispatch; failed ancillary processing and replay; late delivery/reply; provider unsubscribe/complaint/hard versus soft bounce; signature tamper; concurrent policy/dispatch; exact reviewed recipient/body/sender; stale/missing revision; revoke/edit; no raw secret on wire; existing customer workflows and TypeScript/build.

Human/PostgreSQL requirements remain open until performed: two-workspace walkthrough, exact received message inspection, real concurrent connection ordering, upgrade/recovery and selected-provider authentication/send/reply/opt-out. No live sends, deployments or customer database mutations are part of this local slice.

References checked: [SendGrid Event Webhook reference](https://www.twilio.com/docs/sendgrid/for-developers/tracking-events/event), [Event Webhook security](https://www.twilio.com/docs/sendgrid/for-developers/tracking-events/getting-started-event-webhook-security-features), [Inbound Parse security](https://www.twilio.com/docs/sendgrid/for-developers/parsing-email/securing-your-parse-webhooks). Exact signature implementation must follow the primary provider contract.
