# L4-02 shared composer backend verification

Recorded 2026-09-13. Local synthetic implementation evidence under the [completion contract](../COMPLETION_PLAN.md#l4-02-composer-contract) and ADR-023. Live provider, PostgreSQL, browser/operator and customer acceptance remain separate.

## Implemented

ComposerService creates real owner-authored email drafts using existing actions, immutable action_revisions and required pending approval. The append-only action_composer_commands ledger retains CREATE/EDIT request identity, actor/reason and exact resulting revision references. The command, action, revision, approval projection, schedule and audit commit in one workspace transaction. Draft creation and editing perform no provider calls and grant no approval.

A fresh composer read binds current lead/context, sender configuration, the selected inbound reply reference and the entire bounded pending email set. Creating another message requires explicit acknowledgement when pending work exists. A new request key creates an intentional distinct action; an exact retry returns its original immutable result, including after later edits or database restart. The current action review remains a separate lookup. Changed intent under an accepted key conflicts.

REPLY requires an inbound EMAIL message joined to its canonical inbound event within the same workspace/enquiry. The link is contextual: this slice does not set provider thread headers, establish sender authenticity, resolve a response task or reopen a stopped sequence. Existing recommended, bulk-generated and sequence actions retain their action identities and use the same exact-revision edit/review path.

An optional scheduled_at on ApprovalsService.previewAction normalizes an explicit-offset ISO instant to canonical UTC, then changes the action schedule and prepared revision atomically. The earlier subject/body-only contract remains supported. Composer edits and explicit schedule edits refuse any recorded dispatch attempt. Existing retry and uncertain-outcome recovery remains authoritative.

Normal complete-looking SendGrid setup can produce a reviewable draft while retaining CHANNEL_VERIFICATION_REQUIRED at dispatch. Sandbox remains a distinct simulation capability.

## Files and contracts

Owned source: src/modules/outbound-automation/composerContract.js, composerRepository.js, composerService.js and the narrow scheduling addition to approvalsService.js. Owned tests: test/l402-composer.test.js.

Root owns migration0018_action_composer_commands, API wiring, logging, shared documentation, UI and integration verification. PreparedActionService did not require modification.

Service methods are get, create, edit and byRequestKey. Mutations return {command,prepared_revision,replayed}; request recovery returns {command,prepared_revision}, with nulls when absent. The returned prepared revision is the original accepted result, not a later current revision. Public command summaries contain IDs, operation, reply association, reason and actor/time; no private context/configuration fingerprint or credential is returned.

## Bounds and refusal

- Subject: 1..200 characters on one line, excluding controls. Body: 1..10000 characters, nonempty and without null characters. Request keys: 1..200; reasons: 1..2000.
- Complete pending-action comparison: at most 1000 rows, with at most 20 displayed. At exactly 1000, inspection remains available but new draft creation is held. Above 1000, inspection refuses with COMPOSER_PENDING_LIMIT. Displayed pending rows include the current revision identity and schedule; undisplayed rows still influence the review token.
- Lead metadata is checked before full materialization: at most 1 MiB across stored identity/source text. Edited action payloads are checked before materialization at 256 KiB; immutable envelope reads at 64 KiB. Pending action/revision identifiers are capped at 200 characters.
- Reply body plus subject receive metadata-only UTF-8 preflight at 128 KiB, followed by at most 32768 body characters and 1000 subject characters.
- Email configuration uses the existing metadata-first 32-key/64 KiB inspection bound. Existing business-context/freshness bounds and current contact-policy checks remain authoritative.
- GET creates no action, review revision or approval. An adopted freshness policy may advance its existing technical monotonic clock; this is not analysis generation or new message authority.

## Automated evidence

Executed against disposable SQLite with inherited database/provider configuration removed:

~~~powershell
node scripts/run-tests.js --test-concurrency=1 test/l402-composer.test.js test/approval-unit-of-work.test.js
~~~

Integration result: **34 passed, 0 failed, 0 skipped**: 18 composer checks and 16 preserved approval transaction checks. A final concrete enum review then corrected pending acknowledgement to include UNCERTAIN and LEGACY_UNKNOWN histories even when coarse action status is terminal. The final owned rerun, `node scripts/run-tests.js --test-concurrency=1 test/l402-composer.test.js`, passed **19 tests, 0 failed, 0 skipped**, including that added regression. These overlapping runs are not added together.

The composer checks cover:

- Read-only draft inspection and exact user content with mandatory separate approval.
- Concurrent same-key submission, original replay, distinct second-message identity and required pending acknowledgement.
- Changed lead, private sender configuration, reply source and unseen pending action invalidating stale review.
- Current owner/tenant authority and request recovery.
- Reviewed schedule normalization, previous approval invalidation and original result recovery after later edits.
- Invalid calendar/offset inputs and injected CREATE/EDIT audit failure rolling back every related record.
- Scoped canonical inbound reply references without message/task/sequence side effects.
- Restriction/archive refusal and attempted-action edit refusal.
- Existing generated action editing and backward-compatible subject/body preview.
- Complete synthetic SendGrid setup retaining its live hold.
- Oversized source refusal before full lead materialization, pending display/count limits and strict unsupported fields.
- A real materialized sequence step retaining its workflow/action identity after editing and remaining awaiting approval.
- Owned temporary SQLite close/reopen, persisted original-command lookup and exact retry without duplicate work or decisions.

The restart fixture verifies its resolved owned temporary directory before cleanup. Synthetic keys are generated locally. No provider API, live send, hosted model or customer database was used. Root-owned HTTP, migration, browser and final-suite evidence is separate; do not add overlapping focused run totals.

## Remaining acceptance

The normal React first-message/reply/edit/revoke/schedule journey requires integrated browser and operator checks. Real provider verification, transport threading/correlation, delivered/failure/reply behavior, PostgreSQL concurrency/restore and representative customer usefulness remain open. Editing a draft is not an outcome or completed human response. This evidence does not close L4-01, L4-03, the parent L4 phase or launch acceptance.
