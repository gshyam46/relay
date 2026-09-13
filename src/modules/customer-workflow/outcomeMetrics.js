import { ContactPolicyService, assertWorkspaceTransaction } from "../contact-policy/contactPolicyService.js";
import { OUTCOME_KINDS } from "./customerWorkflowContract.js";

const failure = (code, statusCode) => Object.assign(new Error("Recorded outcome metrics require a valid workspace and consistent current outcome records."), { code, statusCode });
const invalidState = () => failure("OUTCOME_METRICS_STATE_INVALID", 503);

// Trusted internal read: the HTTP boundary authenticates the requested workspace.
// Only current heads on active enquiries count. No source text or money is loaded.
export async function loadOutcomeMetrics(db, { organization_id }) {
  if (typeof organization_id !== "string" || !organization_id.trim() || organization_id.length > 256 || /[\u0000-\u001f\u007f]/u.test(organization_id)) {
    throw failure("OUTCOME_METRICS_SCOPE_INVALID", 400);
  }
  if (db.transactionBound) {
    assertWorkspaceTransaction(db, organization_id);
    return aggregate(db, organization_id);
  }
  return new ContactPolicyService(db).withWorkspacePolicyTransaction(organization_id, tx => aggregate(tx, organization_id));
}

async function aggregate(db, org) {
  const rows = await db.all(`
    WITH current_outcomes AS (
      SELECT o.id,o.lead_id,o.slot,r.status,r.kind,r.revision
      FROM business_outcomes o
      JOIN leads l ON l.organization_id=o.organization_id AND l.id=o.lead_id AND l.archived_at IS NULL
      LEFT JOIN business_outcome_revisions r ON r.organization_id=o.organization_id AND r.lead_id=o.lead_id AND r.outcome_id=o.id
        AND r.revision=(SELECT MAX(h.revision) FROM business_outcome_revisions h WHERE h.organization_id=o.organization_id AND h.outcome_id=o.id)
      WHERE o.organization_id=?
    )
    SELECT 'TOTAL' AS category,NULL AS kind,
      COALESCE(SUM(CASE WHEN status='RECORDED' THEN 1 ELSE 0 END),0) AS outcomes,
      COUNT(DISTINCT CASE WHEN status='RECORDED' THEN lead_id ELSE NULL END) AS enquiries,
      COALESCE(SUM(CASE WHEN status='WITHDRAWN' THEN 1 ELSE 0 END),0) AS withdrawn,
      COALESCE(SUM(CASE WHEN revision IS NULL OR status IS NULL OR status NOT IN ('RECORDED','WITHDRAWN')
        OR kind IS NULL OR kind NOT IN ('QUALIFIED_CONVERSATION','MEETING_BOOKED','QUOTE_REQUESTED','WON','LOST')
        OR (slot='RESULT' AND kind NOT IN ('WON','LOST'))
        OR (slot<>'RESULT' AND slot<>kind) THEN 1 ELSE 0 END),0) AS invalid
    FROM current_outcomes
    UNION ALL
    SELECT 'KIND' AS category,kind,COUNT(*) AS outcomes,COUNT(DISTINCT lead_id) AS enquiries,0 AS withdrawn,0 AS invalid
    FROM current_outcomes WHERE status='RECORDED' GROUP BY kind
    LIMIT 7
  `, [org]);
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 6) throw invalidState();
  const totals = rows.filter(row => row.category === "TOTAL");
  if (totals.length !== 1 || count(totals[0].invalid) !== 0) throw invalidState();
  const total = totals[0];
  const result = {
    scope: "ACTIVE_ENQUIRIES",
    recorded_outcomes: count(total.outcomes),
    withdrawn_outcomes: count(total.withdrawn),
    enquiries_with_recorded_outcome: count(total.enquiries),
    by_kind: Object.fromEntries(OUTCOME_KINDS.map(kind => [kind, { outcomes: 0, enquiries: 0 }]))
  };
  const seen = new Set();
  for (const row of rows) {
    if (row.category === "TOTAL") continue;
    if (row.category !== "KIND" || !OUTCOME_KINDS.includes(row.kind) || seen.has(row.kind)) throw invalidState();
    seen.add(row.kind);
    const outcomes = count(row.outcomes), enquiries = count(row.enquiries);
    if (enquiries > outcomes) throw invalidState();
    result.by_kind[row.kind] = { outcomes, enquiries };
  }
  const sum = Object.values(result.by_kind).reduce((value, item) => value + item.outcomes, 0);
  if (!Number.isSafeInteger(sum) || sum !== result.recorded_outcomes || result.enquiries_with_recorded_outcome > result.recorded_outcomes) throw invalidState();
  return result;
}

function count(value) {
  if (typeof value !== "number" && !(typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value))) throw invalidState();
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw invalidState();
  return n;
}
