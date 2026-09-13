# L5-01 backend verification

Recorded 2026-09-13 under [the operational contract](../L5-01_OPERATIONS.md). This evidence covers local structural checking and isolated SQLite recovery tools. It does not certify deployed PostgreSQL privileges, backup retention or a real restore drill.

## Implementation

The committed version1 release manifest covers all80 tables in migrations0001 through0022. It is generated only from a new fully migrated in-memory fixture. Read-only catalog inspection compares actual columns/types/required nullability, ordered index keys/uniqueness/partial predicates, and scoped foreign keys. Missing current structures cannot be hidden by an intact migration ledger. Arbitrary CHECK predicate equivalence, row integrity and cluster security remain separate checks.

PostgreSQL role verification uses three bounded catalog/privilege queries. It distinguishes application CRUD from migration-ledger SELECT-only access, rejects dangerous predefined or inherited role authority/ownership, CREATE, TRUNCATE/REFERENCES/TRIGGER, column-level ledger writes and grant-option delegation. This implements a bounded existing-monolith runtime privilege contract, not minimum column-level grants for each repository. SQLite role verification is explicitly NOT_APPLICABLE.

Explicit local backup and isolated restore CLI commands require absolute paths and new destination directories. The consistent SQLite backup API includes committed WAL data. Metadata retains artifact checksum/size, migration IDs, structural fingerprint and table counts. Rehearsal verifies the checksum, exact copied bytes, integrity, foreign keys and recorded metadata. It never starts an application, model/provider caller, event processor or worker, and does not replace an existing database. Failed cleanup is limited to exclusively owned named files; no recursive delete exists in the implementation.

Owned files are src/database/schemaVerifier.js, runtimeRoleVerifier.js and runtimeSchemaManifest.json; scripts/generate-schema-manifest.js, db-backup.js, db-restore-drill.js and helpers/databaseRecovery.js; test/l501-schema.test.js and l501-recovery.test.js. Root owns runtime/health/deployment/package integration and its separate evidence.

## Final focused run

```text
node scripts/run-tests.js --test-concurrency=1 test/l501-schema.test.js test/l501-recovery.test.js
```

**19 total:18 passed,0 failed,1 explicit PostgreSQL skip.** Earlier individual runs overlap and are not additive.

Structural regressions remove a current table with the migration ledger intact, remove a required column, replace an index using the same name with different keys/predicate, remove scoped-FK catalog evidence, and exercise manifest-version/catalog bounds. Effective privilege fixtures cover inherited dangerous roles, ownership, schema/database CREATE, missing CRUD, column-level ledger mutation, reference/delegation grants and missing/malformed Boolean evidence. The separate actual PostgreSQL catalog test is present but skipped without a dedicated disposable target; synthetic metadata does not prove PostgreSQL SQL execution or real-role provisioning.

Recovery tests preserve an actual historical UNCERTAIN action execution, OPT_OUT restriction and technical high-water. Counts and exact rows remain unchanged; no new attempts or provider usage appear. A live local writer with committed WAL changes proves the engine copy includes those changes. Other cases reject existing targets, relative/missing-parent inputs, symlink/junction ancestry, corrupt archive bytes, lying manifest counts, foreign-key corruption and missing current structures. A CLI child receives hostile database/provider environment values but uses only explicit file arguments and prints no secrets. The only initial test failure was an incorrect fixture clock-column name; it was corrected to the existing high_water_at column without a runtime change.

The current generated structural fingerprint was 560aad0e00253e349302045ec283889113091c4fac7c859ff7321c2844d860d4. A later migration requires intentional manifest regeneration and fresh tests. Local artifact limit 1 GiB, metadata 1 MiB, copy-progress check 60 seconds; subsequent synchronous integrity scans are not claimed to have a hard wall-clock deadline.

## Human and external acceptance

Use the PostgreSQL operator runbook in the contract with a newly isolated target, separate migration/runtime roles, verified TLS, protected credentials and outbound/worker controls disabled before opening the application. Verify real record/history integrity and reconcile uncertainty before any controlled release. This turn did not access a customer database or execute PostgreSQL dump/restore, provider probes, real sends or hosted model calls. Deployment-owned backup encryption/access/retention, recovery objectives, monitoring, PostgreSQL grants/concurrency/restore and a recorded no-resend operator drill remain open.


## Subsequent approved migration refresh

After root finalized 0023_workspace_data_erasures and 0024_pilot_interest_operations, the isolated manifest was intentionally regenerated: 82 tables/24 migrations, fingerprint 47fd584ffa1f3fa9dc28a4bddfcd4f870416f4aaa80c052a6a8971efafa6bb9b. The combined L501/L503 focused run passed 23 checks with 1 explicit PostgreSQL skip; the 19 L501 checks again passed 18 with 1 skip. See [the later operational evidence](L5-03-backend.md). This preserves the prior 80-table result as historical scope. The contract now explicitly blocks restored-data activation until independent current erasure/suppression reconciliation.
