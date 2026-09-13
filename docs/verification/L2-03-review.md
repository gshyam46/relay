# L2-03 source, review and ambiguous-reply safety

Product: **AI Lead Intelligence & Outbound Automation**. Date: **2026-09-12**.
Status: implemented locally under the [recorded identity contract](../L2-03_IDENTITY_RESOLUTION.md); customer, provider and PostgreSQL acceptance remain open.

## Implemented boundary

[Import provenance](../../src/modules/business-context/importProvenance.js) retains the original committed-row and resulting-lead checks. If that authority is absent, a same-workspace resolution must associate this exact import/row with this exact lead. Validation reads the immutable resolution snapshot's normalized_values.enquiry, normalizes its schema and checks the exact field, value, assertion, source reference and observation time. Merely owning another row or lead in the workspace is insufficient. Invalid source uses the existing INVALID_IMPORT_PROVENANCE code; corrupt saved source fails closed as IMPORT_SOURCE_INVALID.

LINK_EXISTING attaches a source without editing the target lead, active enquiry, intelligence, actions or prepared envelope. Imported facts can later be selected through an explicit enquiry correction; that creates a context revision and makes the previous approval stale. CREATE_SEPARATE facts retain the resolution association even while the original row remains unselected PENDING or selected HELD. The original row outcome is not rewritten. Existing direct-contact restrictions remain authoritative; there is no consent or contact graph update.

[Inbound preparation](../../src/modules/channels/inboundMessageService.js) calls the new [ambiguity helper](../../src/modules/channels/ambiguousInboundSafety.js) inside the workspace transaction and receipt lease. A valid contact-only reply matching several enquiries stops their existing sequences and blocks queued linked actions, then cancels only automatic no-response tasks. Human tasks, unrelated/transitive/foreign contacts and in-flight or terminal sends remain unchanged. The same transaction writes a deterministic receipt-scoped AmbiguousInboundWorkStopped audit marker. The unassigned receipt remains quarantined; no canonical message, lead reply event or assigned response task is fabricated. Explicit opt-out still records the direct contact restriction.

A replay with this marker never repeats the stops or assigns a newly unique contact. An older quarantined receipt may already have mandatory policy DONE without a marker. Unassigned processing durably re-establishes PENDING before classification or stop work, so a subsequent failure or overflow cannot leave dispatch permitted. Successful stops and mandatory DONE commit together. Restart/owner retry uses the persisted marker, preserving newer intentional sequences.

[Delayed callback handling](../../src/modules/channels/channelWorkflowService.js) joins received events to their committed ambiguity markers. An ambiguity received since the original dispatch prevents a no-response task when it affects this enquiry or the originally contacted recipient, including after lead contact changes. Confirmed delivery and immutable outgoing copy remain intact. A newer intentional dispatch after the earlier receipt is evaluated independently. Receipt input need not remain unpurged for the join to work.

## Explicit bounds and recovery limits

The reply helper preflights at most **100 directly matched leads, 100 active workflows, 100 queued linked actions and 100 automatic no-response tasks**. Any exceeded limit rejects before stop mutations, preserving the receipt's mandatory PENDING hold. It does not stop a partial subset and declare policy complete.

The callback guard examines at most **100 ambiguity markers received since dispatch**. A confirmed match skips no-response creation; if more markers exist and the bounded set cannot establish safety, callback effects defer with AMBIGUOUS_REPLY_LIMIT. Confirmed delivery remains durable. Invalid marker structure uses AMBIGUOUS_REPLY_STATE_INVALID. The integrating owner exposes these fixed codes through Event recovery.

These are conservative local bounds, not measured capacity promises. Ordinary retry cannot remove an oversized matching set or rewrite immutable reply input. An overflow may require inspected operational remediation; pending mandatory policy keeps workspace sending held and cannot be dismissed. Full provider-thread correlation, owner reassignment and a complete reply composer remain L4-03. Stopped sequences require a new intentional operator decision; receiving an ambiguous reply does not establish contact permission.

## Automated evidence

~~~powershell
node scripts/run-tests.js test/import-identity-safety.test.js test/ambiguous-inbound-safety.test.js test/reviewed-import-provenance.test.js test/inbound-replay.test.js test/callback-replay.test.js test/l2-context-review.test.js test/contact-policy.test.js
~~~

Result: **89 tests, 88 passed, zero failures, one explicitly skipped PostgreSQL test** through the sanitized disposable SQLite launcher. The two new files contribute 18 behavioral tests. No provider/model network calls or customer database writes were made.

Coverage includes unchanged current enquiry/intelligence/approval after source linking; later explicit context correction; exact LINK/CREATE citations and tampering refusal; preserved imported conflict alternatives; original late HELD ledger and opt-out; inferred-source full analysis; ambiguous ordinary replies and direct-only scope; preserved human/in-flight work; failures at workflow, task and marker writes; historical DONE re-hold; restarted owner replay without stopping newer work; contact/workflow/task caps; opt-out with ambiguity; delayed standalone callbacks and changed original recipient; bounded callback scan without losing delivery.

Initial test failures were fixture errors: a SQLite row prototype comparison, an escaped CSV newline and an invalid conflict-fact shape. Fixtures were corrected to the existing contracts; validation was not weakened. A subsequent source error-copy clarification is text-only and leaves codes and authority checks unchanged.

## Human and external QA

Use representative repeated enquiries and genuinely shared customer contacts. Confirm linked conflicting sources remain visible separately, two enquiry histories stay distinct, and operators understand that a shared address does not identify a person. Confirm opt-out survives both decisions and exact outgoing review remains understandable.

Exercise ambiguous replies in Event recovery, recognize the fixed hold/overflow reasons, verify that no reply was assigned or answered, and follow the documented escalation path. Validate real provider threading and PostgreSQL independent-process ordering before live use. Browser, mobile, keyboard and screen-reader acceptance are recorded by the integrating/UI owner; this focused evidence does not close those gates.
