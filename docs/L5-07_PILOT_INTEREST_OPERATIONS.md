# Pilot-interest operator handling

Recorded 2026-09-13 before implementation under COMPLETION_PLAN. This is a local/deployment operator CLI for the separately stored public pilot-interest queue. Workspace owners cannot browse this global intake through the application API. No email, booking or admission is implied or sent.

The CLI must explicitly select its database: either an absolute existing SQLite file or the configured runtime database through an explicit --configured-database flag. It never initializes/migrates a database, selects a default file, uses migration credentials or starts the application/worker. Operators already require database access. It uses the current runtime schema/role checks for deployed targets.

List defaults to 20 records and permits at most 50, status-filtered and cursor-paged, displaying the requested review records only. Mark transitions NEW -> REVIEWED|CLOSED or REVIEWED -> CLOSED. Command request identity and expected current status prevent replay/conflicting updates; exact accepted retries return the original result. Terminal CLOSED records are not silently reopened. An operator reference is required for an audit trail; no email notification is implemented.

Records carry a 90-day expiry. Purge preview selects at most 1000 explicit expired record IDs at a fixed cutoff and returns a reviewed token bound to IDs/current status/expiry. Apply requires those exact IDs, cutoff, token, request identity and operator reference, and rechecks all records in a transaction. Future or changed records cannot be deleted. Matching retry returns the original count. New requests outside the reviewed selection remain. No purge is run automatically during web requests or this implementation session; a deployment operator must schedule the CLI and monitor its results before claiming retention is operational.

Migration 0024 adds public pilot-operation request history containing only bounded command/record identities, finite operation/outcome metadata and operator reference; it must not retain submitted name/email/company/workflow or arbitrary narrative. Public pilot intake/admission and operations serialize on the existing global intake transaction gate. Operator evidence records execution/counts without submitted personal data. Backup/provider retention remains a separate deployment commitment.

Focused tests must cover original replay after later changes, stale status, expired-only selected purge, bounded list, cross-purpose key conflict, atomic rollback and absence of outbound or customer-record effects. Root owns this module/CLI/migration/docs; other agents do not edit these files. Public-contact identity/support-hour publication remains an external founder/operator requirement.

## Operator prerequisites and target selection

Use the release's Node.js runtime from the repository root. Before any command, the deployment owner must identify the exact target, confirm the current schema is already deployed, and authorize the operator's database access. These commands do not migrate, repair or create the database. Use a protected terminal: list output contains submitted personal data.

For an existing local SQLite file, set one explicit absolute path. Replace the example with the inspected target; do not point a rehearsal at a customer database.

```powershell
$pilotDatabase = 'C:\OperatorData\pilot-rehearsal.sqlite'
if (-not [System.IO.Path]::IsPathRooted($pilotDatabase)) { throw 'An absolute database path is required.' }
$pilotDatabase = (Resolve-Path -LiteralPath $pilotDatabase -ErrorAction Stop).Path
if (-not (Test-Path -LiteralPath $pilotDatabase -PathType Leaf)) { throw 'An existing database file is required.' }

node scripts/pilot-interest.js list --database-file $pilotDatabase --status NEW --limit 20
if ($LASTEXITCODE -ne 0) { throw 'The pilot queue could not be read.' }
```

For the deployed PostgreSQL target, use the runtime environment supplied through the deployment's protected configuration. This requires a PostgreSQL DATABASE_URL and otherwise valid application configuration. Staging/production also require verified TLS and the current least-privilege runtime role. Do not use MIGRATION_DATABASE_URL or put credentials in command arguments, input files, examples or logs.

```powershell
node scripts/pilot-interest.js list --configured-database --status NEW --limit 20
if ($LASTEXITCODE -ne 0) { throw 'The configured pilot queue could not be read.' }
```

Pass exactly one target flag. The following examples use --database-file; substitute --configured-database without a value to operate on the approved configured target. Never run both variants for the same operation merely to test connectivity.

## Read and review the queue

List accepts status NEW, REVIEWED or CLOSED, a limit from 1 through 50 (default 20), and the exact next_after_id returned by the previous page. Results are ordered by persisted ID, not arrival time. Check created_at/expiry separately when prioritizing requests.

```powershell
node scripts/pilot-interest.js list --database-file $pilotDatabase --status REVIEWED --limit 20
node scripts/pilot-interest.js list --database-file $pilotDatabase --status NEW --limit 20 --after-id 'pilot_REPLACE_WITH_RETURNED_CURSOR'
```

The response is {requests, has_more, next_after_id, limit}. Each request contains id, name, email, company, workflow, channel, status, created_at and expires_at. Do not copy full output into general application logs or public issue trackers. A review status records internal handling; it does not send a reply, book a meeting, admit a workspace or authorize later marketing.

## Record a reviewed status change

Use an existing protected operator directory for immutable JSON command files. Input paths must be absolute, regular files, at most 1 MiB, and UTF-8 without a byte-order mark. The CLI rejects a symlink input file. The operator remains responsible for directory access and the approved database path.

After actually reviewing the selected request, create this command. Replace record_id with the exact returned ID and operator_reference with a stable internal operator reference, not a submitted name/email or freeform case narrative.

```powershell
$pilotOpsDirectory = (Resolve-Path -LiteralPath 'C:\OperatorData\pilot-commands' -ErrorAction Stop).Path
$pilotMarkKey = 'pilot-mark-' + [guid]::NewGuid().ToString('N')
$pilotMarkFile = Join-Path $pilotOpsDirectory ($pilotMarkKey + '.json')
if (Test-Path -LiteralPath $pilotMarkFile) { throw 'Refusing to replace an existing command.' }
$pilotMarkCommand = [ordered]@{
    request_key = $pilotMarkKey
    operator_reference = 'operator-001'
    record_id = 'pilot_REPLACE_WITH_REVIEWED_RECORD_ID'
    expected_status = 'NEW'
    status = 'REVIEWED'
}
[System.IO.File]::WriteAllText($pilotMarkFile, ($pilotMarkCommand | ConvertTo-Json -Depth 5), [System.Text.UTF8Encoding]::new($false))

node scripts/pilot-interest.js mark --database-file $pilotDatabase --input $pilotMarkFile
if ($LASTEXITCODE -ne 0) { throw 'The status change is unconfirmed; preserve and recover the exact command.' }
```

Allowed transitions are NEW to REVIEWED or CLOSED, and REVIEWED to CLOSED. Closing a reviewed request is a separate command with a new request_key, expected_status REVIEWED and status CLOSED. CLOSED cannot be reopened. The result includes operation_id, operation MARK, record_id, before_status, status, recorded_at and replayed.

If the process or response is lost, rerun the same mark command with the same input file and target. An accepted retry returns the original result with replayed true, even if a later separate command has since closed the request. That result is command history; list again to see its current status.

## Preview and apply one retention batch

Intake sets expires_at to submission time plus 90 days. Marking REVIEWED/CLOSED does not extend this deadline. Purge considers every status, including unreviewed expired requests; a missed review must not silently extend retention.

Preview is read-only and selects at most 1000 expired IDs at one server-generated UTC cutoff. A smaller limit from 1 through 1000 is supported. The CLI does not accept a custom cutoff flag.

```powershell
$pilotPreviewLines = & node scripts/pilot-interest.js preview-purge --database-file $pilotDatabase --limit 1000
if ($LASTEXITCODE -ne 0) { throw 'Purge preview failed; nothing is approved.' }
$pilotPreview = ($pilotPreviewLines -join [Environment]::NewLine) | ConvertFrom-Json
$pilotPreview | Format-List version, cutoff, count, has_more, record_ids
```

Review that preview and the intended target before continuing. A zero count requires no purge. The preview's review_token binds its exact selected IDs, status and expiry at its cutoff; do not fabricate or edit it. A changed status or missing record makes the command stale.

After the operator has reviewed the nonempty batch, create a separate immutable command file:

```powershell
if ($pilotPreview.count -lt 1) { throw 'No expired records were selected; skip purge.' }
$pilotOpsDirectory = (Resolve-Path -LiteralPath 'C:\OperatorData\pilot-commands' -ErrorAction Stop).Path
$pilotPurgeKey = 'pilot-purge-' + [guid]::NewGuid().ToString('N')
$pilotPurgeFile = Join-Path $pilotOpsDirectory ($pilotPurgeKey + '.json')
if (Test-Path -LiteralPath $pilotPurgeFile) { throw 'Refusing to replace an existing command.' }
$pilotPurgeCommand = [ordered]@{
    request_key = $pilotPurgeKey
    operator_reference = 'operator-001'
    record_ids = @($pilotPreview.record_ids)
    cutoff = $pilotPreview.cutoff
    review_token = $pilotPreview.review_token
}
[System.IO.File]::WriteAllText($pilotPurgeFile, ($pilotPurgeCommand | ConvertTo-Json -Depth 5), [System.Text.UTF8Encoding]::new($false))

node scripts/pilot-interest.js purge --database-file $pilotDatabase --input $pilotPurgeFile
if ($LASTEXITCODE -ne 0) { throw 'Purge is unconfirmed; preserve and recover the exact command.' }
```

The result includes operation_id, operation PURGE, record_ids, count, cutoff, recorded_at and replayed. Preserve the input until the result is reconciled. Retrying the same file returns the original accepted count and does not delete new intake. If has_more was true, obtain a new preview after the completed batch and review it as a new command. One successful batch does not establish that the entire expired queue is empty.

## Failure recovery and evidence

Every refusal exits nonzero and prints a bounded error object. Preserve the command and target when the result is uncertain; do not generate a new request key to hide an unknown outcome.

| Code | Operator response |
| --- | --- |
| PILOT_OPERATION_STALE | Inspect current status/expiry, obtain a new review or purge preview, and issue a new command only after reconciling the old one. |
| PILOT_OPERATION_REQUEST_CONFLICT | The key already names different intent. Recover the original command; do not change its file. |
| PILOT_REQUEST_NOT_FOUND | Confirm the target and record history. A separately completed purge may have removed the record. |
| PILOT_OPERATION_INVALID | Check fields, supported transitions, absolute paths and documented bounds. |
| PILOT_OPERATION_LIMIT / PILOT_OPERATION_UNAVAILABLE | Stop and inspect the bounded operation/database condition. Do not bypass limits with direct deletes. |
| PILOT_OPERATION_FAILED with database code | Ask the database operator to resolve schema, connectivity or runtime-role readiness. This CLI performs no repair. |

Record only the target's safe environment label, operation ID/type, operator reference, timestamp, count/status, replay flag and success/failure code in the operational evidence register. Keep personal-data queue exports and immutable command files in the agreed restricted storage, with their own access and deletion policy. Operation receipts contain record IDs and operator references; this slice does not implement automatic receipt-history expiry.

## Scheduling, responsibility and publication gate

The founder or delegated intake owner must assign a primary operator and backup, agree response coverage, review the NEW queue, and decide the permitted follow-up process. No response-time guarantee is established by local implementation.

The deployment operator must schedule and monitor retention review. A concrete starting procedure is a daily preview and reviewed apply window, with failure notification and a follow-up preview until no expired rows remain. This cadence is a proposed operational choice, not an already installed schedule or contractual SLA. Windows Task Scheduler or a deployment scheduler may invoke an approved wrapper under the dedicated runtime identity; that wrapper, protected output handling and alert destination must be reviewed in the actual deployment. Do not schedule an unreviewed direct DELETE or silently turn a failed preview into an empty successful batch. No scheduler job was installed by this implementation.

Before public publication, record one controlled request arriving in the intended deployment queue, actual operator retrieval/handling, a reviewed expired-only retention rehearsal, failure escalation and the accountable privacy/support contacts. Local test acceptance or a locally staged page does not prove public request delivery, staffing, deployed retention or consent for unrelated outreach. Backup copies, exported files, logs and provider-held data require separate retention decisions. L5-07 release quality and the L6-04 founder publication decision remain the authority for going live.
