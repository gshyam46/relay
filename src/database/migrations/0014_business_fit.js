// Additive L3-01 criteria and snapshot assessment; historical rows remain null.
export const id = "0014_business_fit";
export async function up(db) {
  const bytes = column => db.kind === "postgres" ? "octet_length(" + column + ")" : "length(CAST(" + column + " AS BLOB))";
  await db.exec(
    "ALTER TABLE business_profile_revisions ADD COLUMN fit_criteria_json TEXT CHECK(fit_criteria_json IS NULL OR " + bytes("fit_criteria_json") + " BETWEEN 2 AND 32768);" +
    "ALTER TABLE intelligence_snapshots ADD COLUMN business_fit_json TEXT CHECK(business_fit_json IS NULL OR " + bytes("business_fit_json") + " BETWEEN 2 AND 131072);"
  );
}
