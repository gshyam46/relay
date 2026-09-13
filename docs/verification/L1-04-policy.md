# L1-04 Contact Policy Verification

Date: 2026-09-11. Product: **AI Lead Intelligence & Outbound Automation**.

## Implemented scope

This is the owned contact-policy and migration portion of the user-authorized L1-04/L1-08 slice. The [dispatch contract](../L1-04_L1-08_DISPATCH.md) was agreed before implementation. API/provider/dispatch composition, immutable review and browser behavior have their own integrating evidence. [TASKS.md](../TASKS.md) owns acceptance status.

Files:

- [Contact policy contract](../../src/modules/contact-policy/contactPolicyContract.js): canonical identity, recipient selection, reasons, sources and channel mapping.
- [Contact policy service](../../src/modules/contact-policy/contactPolicyService.js): workspace transaction gate, durable restriction commands and inspection.
- [Contact policy repository](../../src/modules/contact-policy/contactPolicyRepository.js): append-only restriction records, queued cancellation and audit.
- [Migration 0003](../../src/database/migrations/0003_contact_restrictions.js): frozen schema and historical backfill.
- [Migration registry](../../src/database/migrations/index.js): ordered 0003 and reviewed 0004 registration; neither 0001 nor 0002 changed.
- [Lead repository](../../src/modules/data-foundation/leadsRepository.js): validated normalized contact creation and preservation of existing restricted lifecycle statuses.
- [Behavior tests](../../test/contact-policy.test.js) and updated [upgrade tests](../../test/migration-safety.test.js).

## Exact behavior

ContactPolicyService takes the database client directly. withWorkspacePolicyTransaction(organizationId, work(tx)) opens a scoped transaction and locks the organizations row before any action/review rows. PostgreSQL uses FOR UPDATE with a 5000 ms lock timeout; SQLite uses bounded BEGIN IMMEDIATE acquisition. The callback must contain only short database work. A module-wide gate marker permits another service instance to use the same scoped client; unguarded, wrong-workspace and expired contexts are refused.

restrictLead/restrictContact have matching InTransaction variants. Inspection returns restricted, reason, contact and restriction_ids; it does not return consent or an unconditional permission to send. Missing or invalid contact on a requested sending channel returns CONTACT_UNRESOLVED. Display inspection defaults to ALL; dispatch uses its explicit channel and captured recipient.

Restrictions identify the workspace, LEAD/EMAIL/PHONE value, ALL or channel scope, reason, source, stable source event, actor and times. Valid reasons are OPT_OUT, SUPPRESSED, UNSUBSCRIBE, COMPLAINT, HARD_BOUNCE and DELIVERY_REVIEW. Sources distinguish inbound, provider, manual and historical backfill. Source event IDs are bounded to 500 characters; integrations can hash their original provider/event identity. Reusing an existing event/scope with conflicting reason or source lead fails without rewriting its provenance.

Email normalization trims and lowercases a validated address; it does not merge plus-addresses or infer provider aliases. Phone normalization accepts an explicit valid international number only. Existing normalized fields are validated rather than blindly trusted; valid raw contact alternatives remain available. A local phone without country context stays unresolved.

A general lead opt-out records its LEAD identity plus current valid email/phone identities with ALL scope. An ALL restriction on any directly matching identity blocks all sending channels for that lead/duplicate. This is conservative handling of shared contacts; it does not create additional restrictions from the duplicate's other identities or propagate through a contact graph. A provider EMAIL restriction affects EMAIL only. No cross-workspace identity lookup or person merge occurs.

A restriction command atomically persists its records, stops applicable queued SEND actions, cancels channel follow-ups, stops workflows with an applicable remaining send step, and writes an audit event. It preserves human tasks and unrelated-channel work for channel-specific restrictions. EXECUTING, completed and failed action history is not reactivated or rewritten. Compatible event retries recheck queued work while retaining the original restriction and audit identity.

Ordinary lifecycle writes cannot clear OPTED_OUT/SUPPRESSED, and SUPPRESSED cannot be weakened to OPTED_OUT. New logical opt-out/provider writers must use the policy service: updateLeadStatus is a compatibility guard, not an alternative audited contact-policy command. New imports or inbound-created records are checked against persisted identities; no copying of a consent flag is required.

No restriction-removal or inferred re-consent endpoint is introduced. Corrections/resubscription require an explicitly designed, evidenced and authorized recovery flow.

## Historical upgrade boundaries

Migration 0003 preserves existing OPTED_OUT/SUPPRESSED, recorded inbound OPT_OUT even when later status became ACTIVE, and supported historical provider records. It stops applicable queued work and keeps in-flight/completed histories intact.

Legacy EmailTrackingEvent records supply unsubscribe/group-unsubscribe evidence. Recorded callback details can supply complaint or bounce history through a tenant-owned action. Historical generic bounce lacks the original hard/soft type; it becomes DELIVERY_REVIEW, not an invented hard bounce or consent revocation.

Old provider records often omitted the actual recipient. Their backfill uses the associated lead and currently validated email with LEGACY_PROVIDER provenance. It cannot reconstruct an absent historical address or silently guess a phone country. Malformed/unrecognized legacy metadata is not treated as evidence. An actual restored database still needs an inventory and human recovery review before live use.

The frozen migration contains its own normalization/backfill helpers; future runtime changes cannot silently change how an applied migration is defined. Contact matching during backfill uses an identity map instead of comparing every lead with every restriction. Migration processing still requires capacity assessment on a production-shaped restored dataset.

## Local automated evidence

Executed through the sanitized test launcher:

~~~powershell
node scripts/run-tests.js test/contact-policy.test.js test/migration-safety.test.js
~~~

Result: 30 tests total, 26 passed, 4 PostgreSQL cases skipped, 0 failed. Contact policy contributes 13 passing tests and one explicitly gated PostgreSQL test; migration safety contributes 13 passing tests and three PostgreSQL cases.

Passing behavior covers:

- Exact normalization, ambiguous phone refusal and missing-contact inspection.
- Tenant isolation, scoped gate enforcement, malformed input and escaped contexts.
- General opt-out on direct duplicate identities without transitive propagation.
- Channel-specific provider restrictions before a future import/restart.
- Relevant queued action/follow-up/workflow cancellation and preserved in-flight/completed/human work.
- Compatible duplicate repair, conflicting event refusal and immutable provenance.
- Rollback of restriction, cancellation, status and audit together.
- Protection against ordinary lifecycle status clearing.
- Historical overwritten opt-out, unsubscribe and uncertain bounce backfill.
- Real independent SQLite connections ordering dispatch authorization before later suppression.
- The previously established migration history, rollback, upgrade, locking and interruption regressions across the new version chain.

The PostgreSQL policy case is implemented behind the explicit disposable harness and was skipped locally. SQLite ordering is not PostgreSQL production-concurrency proof.

## Remaining acceptance and operating limits

The integration must use the workspace gate before action/review locks and send the exact captured recipient after authorization; a later mutable lookup would break the contract. Root-owned dispatch/provider/inbound tests establish those paths separately.

Queued cancellation currently scans leads in the affected workspace and compares a small set of canonical identities. This is a deliberate pilot implementation boundary, not a measured scale guarantee. Measure tenant size, lock duration and noisy-tenant effects; move matching to indexed canonical identity records if measurements require it. Keep external work outside the gate.

Required human/PostgreSQL QA remains open: restored-schema inventory, restricted runtime roles, concurrent real PostgreSQL ordering, correct recipient copy, opt-out during a controlled in-flight send, and duplicate import/customer workflow behavior. No customer database, cloud deployment or real recipient was used by these tests.
