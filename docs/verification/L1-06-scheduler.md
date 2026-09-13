# L1-06 scheduler and lead-processing recovery evidence

Product: **AI Lead Intelligence & Outbound Automation**.
Date: 2026-09-11.
Status: local scheduler behavior and shared client typecheck/build verified. The integrating owner records the complete runtime slice and external gates separately.

Contract: [L1-06 scheduling](../L1-06_SCHEDULING.md). This evidence is one implementation slice, not L1 launch certification.

## Implemented behavior

SchedulerService reserves one eligible workspace at a time using the persisted singleton cursor and a short database transaction. PostgreSQL locks the cursor row; SQLite uses its transaction write lock. Six typed, workspace-leading candidate queries each return at most one next workspace; their union selects the next ID after the cursor and wraps once. No organization list, per-row JSON decoding, or global oldest-job batch determines fairness. A tick admits at most four distinct workspaces and a scoped tick admits at most its requested workspace.

A reserved visit carries its own random owner, increasing fence, and 120-second lease. Before a phase starts, a short transaction checks exact ownership and the live lease and persists the next phase. Phase callbacks run outside scheduler transactions and retain their own domain claims. The fixed phase budgets are receipts 2, domain events 1, workflows 2, follow-ups 5, dispatch 2, and expired dispatch attempts 2. The 10-second monotonic admission budget stops new visits/phases; it does not cancel already admitted work or promise a hard 10-second completion time. UTC wall time controls persisted due times and leases.

Live visits exclude other processes. Lease expiry prevents the old visit from admitting another phase; conditional release cannot clear a newer visit. stopAccepting/stop stops admission, and drain awaits current ticks. Cursor reservation and phase writes perform no provider or model work. Phase failures return a fixed category without raw exception messages or stacks.

Eligibility includes interrupted/conflicting receipts, managed due domain events, the shared workflow predicate, due/malformed follow-ups, due/malformed actions, and expired dispatches. Future work, legacy held events, unchanged approval/accepted/uncertain workflow waits, and valid paused workflow actions do not consume turns. A workspace whose only work is dispatch awaiting mandatory receipt policy is excluded; its independent recovery work remains eligible. Malformed follow-up times become one visible BLOCKED outcome through the follow-up phase.

The existing Event recovery page now offers distinct Received events and Lead processing views. The latter displays affected lead, operation, safe reason, status, attempts, timing, stage progress, and review history. An owner can submit a bounded evidence note and RETRY/CLOSE against the loaded processing fence when the server permits it. The UI never offers payload edits, budget resets, or automatic legacy promotion. Closing lead processing leaves independent received-event policy checks intact. Native modal focus/escape handling, labels, loading/error/empty states, pagination, and small-screen wrapping are implemented; browser human QA remains open.

## Interfaces and files

- src/modules/events/schedulerService.js: SchedulerService({db, now, monotonicNow, handlers, policy}); runOnce({organization_id=null}); stopAccepting(), stop(), drain(). Policy defaults/maxima are maxVisits=4, admissionBudgetMs=10000, leaseMs=120000; tests may tighten bounds. handlers are RECEIPTS/EVENTS/WORKFLOWS/FOLLOW_UPS/DISPATCH/EXPIRY and receive {organization_id,limit,due_at}. Results retain visits/phases and flatten processed_events/executed_actions/processed_runs/due_follow_ups for Worker compatibility, plus elapsed_ms/draining.
- test/scheduler-fairness.test.js: scheduler behavior and one explicitly guarded real PostgreSQL test.
- client/src/components/domain-event-recovery.tsx and client/src/pages/event-recovery.tsx: separate owner lead-processing view using the integrating owner's GET /api/domain-events, GET /api/domain-events/:id, and POST /api/domain-events/:id/review contracts.
- Migration 0007, domain processing/stages, workflow eligibility/actions, shared API/Worker/server wiring and primary specifications belong to their coordinated owners.

## Automated evidence

Command: node scripts/run-tests.js test/scheduler-fairness.test.js.
Result: **15 tests, 14 passed, 1 real PostgreSQL test skipped, 0 failures**. The isolated runner removed inherited provider/database configuration and used disposable SQLite fixtures.

Covered behavior:

- Sixty extra jobs in the first workspace cannot hide others; four distinct visits, cursor wrap, file reopen and explicit workspace scope.
- All six typed candidate sources, including an expired attempt whose action is already executing.
- Future queues, historical event holds, mandatory-policy dispatch holds, unchanged approval/accepted/uncertain waits, and paused workflow action exclusion.
- Malformed event times remain visible; malformed follow-up timing becomes BLOCKED once.
- Fixed phase limits and scoped callback inputs, compatible aggregate result arrays, and callbacks outside scheduler transactions.
- Slow phase advances its durable successor before work; the next service starts with that successor.
- Deadline reached during cursor acquisition performs no cursor advance or visit reservation.
- Separate SQLite connections select distinct live tenants; shutdown awaits the admitted callback and starts no further phase.
- An expired old visit cannot advance or release a newer live visit.
- Deleted cursor tenants and newly added lower IDs wrap correctly; phase errors cannot expose raw secret-like exception content.
- Future/expired/conflicting receipts respect organization scope and eligibility.

Combined command: node scripts/run-tests.js test/scheduler-fairness.test.js test/scheduler-migrations.test.js test/event-repository.test.js test/scheduler-runtime.test.js. Result: **34 tests, 28 passed, 6 real PostgreSQL tests skipped, 0 failures**. This includes the integrating owner's normal-server sequence pause/restart behavior and the migration/event repository owners' scoped persistence checks.

node --check src/modules/events/schedulerService.js passed. node scripts/format-check.js passed for 236 files at this checkpoint. From client/, direct node node_modules/typescript/bin/tsc -b and node node_modules/vite/bin/vite.js build both passed after the coordinated Workflows page was available. Vite emitted the existing large-chunk warning: the generated application JavaScript was 901.18 kB (251.35 kB gzip). This is bundling evidence, not browser interaction or performance proof.

## Remaining proof and practical limits

The guarded PostgreSQL test exists but was not run without explicit disposable PostgreSQL configuration. Verify cursor row locking, cross-process exclusion, candidate query plans/index use, clock synchronization and measured tenant lag/load before capacity claims. Bounded query output is not a constant database scan-cost claim. Existing PostgreSQL TLS/role/restore gates remain open.

Human QA must inspect both recovery views using an owner and non-owner, exercise keyboard focus/escape and mobile layout, verify stale-fence decisions and evidence history, and follow normal server restart/pause/resume through real lead processing. No live provider sends, deployment, customer acceptance, or browser visual verification is claimed here. The complete landing-page implementation remains its later planned work and is not part of this scheduler slice.
