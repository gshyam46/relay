import { createHash } from "node:crypto";
// Frozen L2-02 expansion. Historical batches retain contract version zero.
export const id = "0010_reviewed_import";
export async function up(db) {
  const bytes = column => db.kind === "postgres" ? "octet_length(" + column + ")" : "length(CAST(" + column + " AS BLOB))";
  await db.exec(`
    ALTER TABLE leads ADD COLUMN normalized_name_company_key TEXT;
    CREATE INDEX idx_leads_workspace_name_company_key ON leads(organization_id,normalized_name_company_key);
    ALTER TABLE import_batches ADD COLUMN contract_version INTEGER NOT NULL DEFAULT 0 CHECK(contract_version IN (0,1,2));
    ALTER TABLE import_batches ADD COLUMN review_revision INTEGER NOT NULL DEFAULT 0 CHECK(review_revision BETWEEN 0 AND 2147483647 AND review_revision=CAST(review_revision AS INTEGER));
    ALTER TABLE import_batches ADD COLUMN frozen_selection_json TEXT;
    ALTER TABLE import_batches ADD COLUMN commit_revision INTEGER CHECK(commit_revision IS NULL OR (commit_revision BETWEEN 1 AND 101 AND commit_revision=CAST(commit_revision AS INTEGER)));
    ALTER TABLE import_batches ADD COLUMN created_by TEXT REFERENCES users(id);
    ALTER TABLE import_rows ADD COLUMN raw_cells_json TEXT;
    ALTER TABLE import_rows ADD COLUMN commit_state TEXT NOT NULL DEFAULT 'PENDING' CHECK(commit_state IN ('PENDING','COMMITTED','HELD'));
    ALTER TABLE import_rows ADD COLUMN hold_reason TEXT;
    CREATE UNIQUE INDEX idx_import_batches_workspace_identity ON import_batches(organization_id,id);
    CREATE UNIQUE INDEX idx_import_rows_workspace_import_identity ON import_rows(organization_id,import_id,id);
    CREATE UNIQUE INDEX idx_events_workspace_identity ON domain_events(organization_id,id);
    CREATE TABLE import_row_corrections (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      import_id TEXT NOT NULL,
      import_row_id TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK(revision BETWEEN 2 AND 101),
      reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 2000),
      before_json TEXT NOT NULL CHECK(${bytes("before_json")} BETWEEN 2 AND 2097152),
      after_json TEXT NOT NULL CHECK(${bytes("after_json")} BETWEEN 2 AND 2097152),
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL,
      UNIQUE(organization_id,import_id,revision),
      FOREIGN KEY(organization_id,import_id) REFERENCES import_batches(organization_id,id),
      FOREIGN KEY(organization_id,import_id,import_row_id) REFERENCES import_rows(organization_id,import_id,id),
      FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id)
    );
    CREATE TABLE import_row_outcomes (
      organization_id TEXT NOT NULL,
      import_id TEXT NOT NULL,
      import_row_id TEXT NOT NULL,
      review_revision INTEGER NOT NULL CHECK(review_revision BETWEEN 1 AND 101),
      state TEXT NOT NULL CHECK(state IN ('COMMITTED','HELD')),
      lead_id TEXT,
      event_id TEXT,
      hold_reason TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY(organization_id,import_row_id),
      UNIQUE(organization_id,lead_id),
      UNIQUE(organization_id,event_id),
      FOREIGN KEY(organization_id,import_id) REFERENCES import_batches(organization_id,id),
      FOREIGN KEY(organization_id,import_id,import_row_id) REFERENCES import_rows(organization_id,import_id,id),
      FOREIGN KEY(organization_id,lead_id) REFERENCES leads(organization_id,id),
      FOREIGN KEY(organization_id,event_id) REFERENCES domain_events(organization_id,id),
      CHECK((state='COMMITTED' AND lead_id IS NOT NULL AND event_id IS NOT NULL AND hold_reason IS NULL)
        OR (state='HELD' AND lead_id IS NULL AND event_id IS NULL AND hold_reason='DUPLICATE_REVIEW_REQUIRED'))
    );
  `);
  // Frozen version-1 lookup algorithm; do not import mutable application helpers.
  // Only this derived lookup field is backfilled, in bounded primary-key pages.
  let after = null;
  while (true) {
    const rows = await db.all("SELECT id,name,company FROM leads" + (after === null ? "" : " WHERE id>?") + " ORDER BY id LIMIT 200", after === null ? [] : [after]);
    if (!rows.length) break;
    for (const row of rows) {
      const name = typeof row.name === "string" ? row.name.trim().toLowerCase() : "";
      const company = typeof row.company === "string" ? row.company.trim().toLowerCase() : "";
      const key = name && company ? createHash("sha256").update(name + "|" + company).digest("hex") : null;
      await db.run("UPDATE leads SET normalized_name_company_key=? WHERE id=?", [key, row.id]);
    }
    after = rows.at(-1).id;
  }
}
