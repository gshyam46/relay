# L5-04 workspace customer-data lifecycle verification

Date:2026-09-13. Contract:[workspace data lifecycle](../L5-04_DATA_LIFECYCLE.md). This evidence covers local implementation on disposable synthetic SQLite databases; it does not certify customer retention policy, actual provider erasure, PostgreSQL deployment or backup activation.

## Implemented

WorkspaceDataLifecycleService provides owner/session-scoped inspection, bounded portable JSON export, exact-state erasure review, password-confirmed atomic customer erasure, original-request recovery and paged receipt history. The explicit release inventory contains82 tables. action_executions scopes through actions; global pilot/admission/schema/scheduler data is excluded from tenant operations. Unknown tables or columns refuse export/erasure until the inventory is reviewed.

SQL checks50,000 scoped rows/32MiB field bytes before materializing source bodies. Export also caps its encoded response at64MiB. It includes canonical source/customer records and safe owner/workspace identity while explicitly omitting operational secrets, raw transport/error/audit blobs and protected evaluation datasets/membership. It does not fetch remote content or attachment binaries.

Erasure rechecks current password/session/authentication revision and the complete reviewed customer-state hash under the same workspace gate used by runtime actions. Original same-key completion remains recoverable and cannot erase newly added records. A completed-only receipt, fixed audit summary, restriction sanitization, setup reset and dispatch pause commit with explicit child-first deletion; documented action/revision/execution/workflow pointers are detached without disabling foreign keys. Account/security state and normalized contact restrictions remain. The technical high-water clock preserves receipt ordering under clock rollback.

Active or uncertain dispatch, CLOSED_UNRESOLVED outcomes, legacy outcome-review flags, PROCESSING event/receipt ownership, pending mandatory policy, ADMITTED/UNCONFIRMED model calls, RUNNING provider checks and owned scheduler claims hold erasure. An expired lease is not proof of cancelled external work. The actual delayed Sandbox invocation regression verifies this against the real executor admission and settlement path.

## Executed checks

Safe command:

~~~text
node scripts/run-tests.js test/l504-workspace-data.test.js test/l502-account-security.test.js test/l304-evaluation-runtime.test.js test/prepared-action-review.test.js
~~~

Result:70 passed,0 failed,0 skipped. This comprises21 new lifecycle cases,20 existing account-security cases,12 protected evaluation cases and17 prepared-action review cases.

New cases cover tenant export and indirect executions; real canonical reply plus private HOLDOUT dataset/evaluation; full snapshot/synthesis/recommendation/plan and prepared composer removal; original import rows/outcomes and canonical route reset; all action/execution/revision/workflow FK cycles; foreign-tenant preservation; current password/session/KDF race; changed customer/configuration state; accepted replay after later data creation; trigger-injected atomic rollback; retained suppression after reimport; active/expired/unknown provider and worker states; actual delayed Sandbox execution; record and byte preflight; unexpected schema; paged/history-integrity checks; and physical-clock rollback.

One initial test fixture used incorrect existing classifier/contact, workflow/import and adapter method names; those fixtures were corrected to real contracts. A delayed fixture waiting on the wrong adapter method was stopped, corrected to invoke and rerun. No runtime guard was relaxed to make fixtures pass. The first independently observed legacy action-without-execution hold gap was fixed and has a regression. All final tests above pass.

No live provider or model endpoint was called. No real customer database or filesystem data was exported or erased. Provider results in related transport tests are injected. The new tests operate on disposable in-memory SQLite only; the approved wrapper strips inherited database/provider configuration. No owned servers or temporary logs remain.

## Boundaries and human QA

Root owns HTTP/current signed-route rechecks, migration0023/registry and the React flow; their integration evidence is recorded separately. Current active database deletion does not overwrite storage pages, journals, replicas, exported files, backups, provider copies or externally referenced attachments. There is no automatic retention schedule, force-erase switch, full account deletion or external deletion workflow.

A responsible owner must review the portable export, retained account/suppression exceptions and the real support process. Human QA must confirm exact review, password rejection, lost-response lookup, post-erasure login/recovery, paused sending and fresh setup. Operations must reconcile uncertain invocations and independently retain authoritative erasure/suppression evidence. An older backup cannot reveal later erasures: restore remains isolated with workers/outbound off until independent reconciliation permits activation. Actual PostgreSQL FK/transaction/privilege evidence and customer-approved processing/retention periods remain separate gates.
