// Frozen additive L2-05 assessment metadata and technical monotonic workspace time.
export const id = "0013_intelligence_freshness";
export async function up(db) {
  const bytes = db.kind === "postgres" ? "octet_length(freshness_json)" : "length(CAST(freshness_json AS BLOB))";
  await db.exec(
    "ALTER TABLE intelligence_snapshots ADD COLUMN freshness_json TEXT CHECK(freshness_json IS NULL OR " + bytes + " BETWEEN 2 AND 262144);" +
    "CREATE TABLE workspace_freshness_clocks (organization_id TEXT PRIMARY KEY REFERENCES organizations(id),high_water_at TEXT NOT NULL CHECK(length(high_water_at)=24));"
  );
}
