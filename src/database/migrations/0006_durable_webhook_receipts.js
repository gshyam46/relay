// Frozen receipt expansion. Historical domain rows have no proven processing
// cursor: preserve them as LEGACY_UNKNOWN, with no synthesized inbox work.
export const id = "0006_durable_webhook_receipts";

export async function up(db) {
  const hexCheck = (column) => "length(" + column + ") = 64 AND " + (db.kind === "postgres"
    ? column + " !~ '[^0-9a-f]'" : column + " NOT GLOB '*[^0-9a-f]*'");
  await db.exec(`
    CREATE TABLE webhook_receipts (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id),
      provider TEXT NOT NULL CHECK(length(trim(provider)) > 0),
      connection_key TEXT NOT NULL CHECK(length(trim(connection_key)) > 0),
      provider_event_id TEXT NOT NULL CHECK(length(trim(provider_event_id)) > 0),
      event_kind TEXT NOT NULL CHECK(event_kind IN ('EXECUTION_CALLBACK','SENDGRID_EVENT','INBOUND_MESSAGE')),
      normalization_version INTEGER NOT NULL DEFAULT 1 CHECK(normalization_version > 0 AND normalization_version = CAST(normalization_version AS INTEGER)),
      normalized_input_json TEXT,
      payload_hash TEXT NOT NULL CHECK(${hexCheck("payload_hash")}),
      identity_hash TEXT NOT NULL UNIQUE CHECK(${hexCheck("identity_hash")}),
      verification_kind TEXT NOT NULL CHECK(verification_kind IN ('SIGNED_PROVIDER','TRUSTED_INTERNAL','LOCAL_TEST')),
      received_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      processing_state TEXT NOT NULL DEFAULT 'RECEIVED' CHECK(processing_state IN ('RECEIVED','PROCESSING','RETRY_PENDING','PROCESSED','QUARANTINED','DISMISSED')),
      mandatory_policy_status TEXT NOT NULL DEFAULT 'PENDING' CHECK(mandatory_policy_status IN ('PENDING','DONE')),
      attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0 AND attempts = CAST(attempts AS INTEGER)),
      max_attempts INTEGER NOT NULL DEFAULT 5 CHECK(max_attempts BETWEEN 1 AND 100 AND max_attempts = CAST(max_attempts AS INTEGER)),
      first_processing_at TEXT,
      retry_deadline_at TEXT,
      next_attempt_at TEXT,
      lease_owner TEXT,
      lease_expires_at TEXT,
      processing_fence INTEGER NOT NULL DEFAULT 0 CHECK(processing_fence >= 0 AND processing_fence = CAST(processing_fence AS INTEGER)),
      last_error_code TEXT,
      quarantined_reason TEXT,
      processed_at TEXT,
      payload_purged_at TEXT,
      CHECK((normalized_input_json IS NOT NULL AND payload_purged_at IS NULL)
        OR (normalized_input_json IS NULL AND payload_purged_at IS NOT NULL AND processing_state IN ('PROCESSED','DISMISSED')))
    );
    CREATE INDEX idx_webhook_receipts_tenant_updated ON webhook_receipts(organization_id, updated_at, id);
    CREATE INDEX idx_webhook_receipts_due ON webhook_receipts(processing_state, next_attempt_at, received_at, id);
    CREATE INDEX idx_webhook_receipts_lease ON webhook_receipts(processing_state, lease_expires_at, id);
    CREATE INDEX idx_webhook_receipts_retention ON webhook_receipts(processing_state, processed_at, id);

    ALTER TABLE callbacks ADD COLUMN webhook_receipt_id TEXT REFERENCES webhook_receipts(id);
    ALTER TABLE callbacks ADD COLUMN core_applied INTEGER CHECK(core_applied IS NULL OR core_applied IN (0,1));
    ALTER TABLE callbacks ADD COLUMN action_applied INTEGER CHECK(action_applied IS NULL OR action_applied IN (0,1));
    ALTER TABLE callbacks ADD COLUMN effects_status TEXT NOT NULL DEFAULT 'LEGACY_UNKNOWN' CHECK(effects_status IN ('LEGACY_UNKNOWN','PENDING','DONE','SKIPPED'));
    ALTER TABLE callbacks ADD COLUMN effects_completed_at TEXT;
    CREATE UNIQUE INDEX idx_callbacks_webhook_receipt ON callbacks(webhook_receipt_id) WHERE webhook_receipt_id IS NOT NULL;

    ALTER TABLE inbound_events ADD COLUMN webhook_receipt_id TEXT REFERENCES webhook_receipts(id);
    ALTER TABLE inbound_events ADD COLUMN effects_status TEXT NOT NULL DEFAULT 'LEGACY_UNKNOWN' CHECK(effects_status IN ('LEGACY_UNKNOWN','PENDING','DONE'));
    ALTER TABLE inbound_events ADD COLUMN effects_completed_at TEXT;
    CREATE UNIQUE INDEX idx_inbound_events_webhook_receipt ON inbound_events(webhook_receipt_id) WHERE webhook_receipt_id IS NOT NULL;

    CREATE TABLE webhook_receipt_reviews (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id),
      receipt_id TEXT NOT NULL REFERENCES webhook_receipts(id),
      expected_fence INTEGER NOT NULL CHECK(expected_fence >= 0 AND expected_fence = CAST(expected_fence AS INTEGER)),
      decision TEXT NOT NULL CHECK(decision IN ('RETRY','CLOSE')),
      evidence_note TEXT NOT NULL CHECK(length(trim(evidence_note)) > 0 AND length(evidence_note) <= 2000),
      reviewer_user_id TEXT NOT NULL CHECK(length(trim(reviewer_user_id)) > 0 AND length(reviewer_user_id) <= 256),
      created_at TEXT NOT NULL,
      UNIQUE(receipt_id, expected_fence)
    );
    CREATE INDEX idx_webhook_receipt_reviews_tenant ON webhook_receipt_reviews(organization_id, receipt_id, created_at);
  `);
}
