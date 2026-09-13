import { feedbackError, feedbackHash, parseFeedbackJson, byteLengthSql, MAX_TARGET_BYTES, REPLY_CATEGORIES } from "./intelligenceFeedbackContract.js";
import { assertWorkspaceTransaction } from "../contact-policy/contactPolicyService.js";
import { publicReplyInterpretation } from "../channels/replyInterpretationView.js";
const TABLES = {
  SNAPSHOT: { table: "intelligence_snapshots", key: "snapshot_id", columns: ["id","organization_id","lead_id","version","pipeline_version","input_fingerprint","readiness_status","readiness_score","summary","score","next_best_action","evidence_json","created_at","freshness_json","business_fit_json"] },
  SYNTHESIS: { table: "intelligence_synthesis_runs", key: "synthesis_id", columns: ["id","organization_id","lead_id","snapshot_id","version","pipeline_version","input_fingerprint","summary_json","findings_json","qualification_json","recommendation_json","evidence_refs_json","created_at","completed_at"] },
  RECOMMENDATION: { table: "intelligence_recommendation_runs", key: "recommendation_id", columns: ["id","organization_id","lead_id","snapshot_id","synthesis_id","version","pipeline_version","input_fingerprint","priority_json","segment_json","personalization_json","recommendation_json","evidence_refs_json","created_at","completed_at"] },
  PLAN: { table: "next_best_action_plans", key: "plan_id", columns: ["id","organization_id","lead_id","snapshot_id","synthesis_id","intelligence_recommendation_id","version","pipeline_version","input_fingerprint","action_type","title","rationale","policy_decision_json","approval_json","decision_evidence_refs_json","execution_contract_json","created_at","completed_at"] },
  REPLY: { table: "channel_messages", key: "message_id", columns: ["id","organization_id","lead_id","inbound_event_id","direction","channel","subject","body","summary","classification_event_type","classification_confidence","suggested_next_step","payload_json","occurred_at","created_at"] }
};
const CHILDREN = {
  intelligence_evidence: ["id","organization_id","lead_id","snapshot_id","source_type","source_reference","source_url","title","raw_content_reference","claim_field","claim_value","evidence_timestamp","retrieved_at","confidence","metadata_json","created_at"],
  intelligence_claims: ["id","organization_id","lead_id","snapshot_id","field","value_json","confidence","evidence_ids_json","created_at"],
  intelligence_signals: ["id","organization_id","lead_id","snapshot_id","type","value","confidence","explanation","evidence_ids_json","created_at"],
  intelligence_qualifications: ["id","organization_id","lead_id","snapshot_id","status","readiness_score","reasons_json","signal_ids_json","evidence_ids_json","created_at"],
  intelligence_recommendations: ["id","organization_id","lead_id","snapshot_id","action_type","outbound_action_type","reason","confidence","evidence_ids_json","created_at"]
};
const sizeSql = (db, columns) => columns.map(column => "COALESCE(" + byteLengthSql(db, column) + ",0)").join("+");
function decoded(row) {
  return Object.fromEntries(Object.entries(row).map(([key,value]) => [key.endsWith("_json") ? key.slice(0,-5) : key, key.endsWith("_json") && value !== null ? parseFeedbackJson(value) : value]));
}
function tooLarge() { return feedbackError("FEEDBACK_TARGET_TOO_LARGE", "This saved target exceeds the supported review bound.", 413); }
function invalid() { return feedbackError("FEEDBACK_TARGET_INVALID", "This saved target requires operational inspection before review.", 409); }
function presentation(kind, output, reply) {
  let truncated = false;
  const clip = (value, limit) => { const text = typeof value === "string" ? value : JSON.stringify(value ?? ""); if (text.length > limit) truncated = true; return text.slice(0,limit); };
  const titles = { SNAPSHOT: "Saved lead assessment", SYNTHESIS: "Saved intelligence summary", RECOMMENDATION: "Saved recommendation", PLAN: "Saved action plan", REPLY: "Recorded reply interpretation" };
  if (kind === "REPLY") return { title: titles[kind], summary: clip(output.interpretation.reason, 4000), fields: [{ label: "Recorded category", value: output.recorded_category }, { label: "Original reply input", value: reply ? "Available for explicitly nominated local evaluation." : "Unavailable for replay; operational feedback remains possible." }], truncated };
  const summary = output.summary?.text || output.summary || output.rationale || output.recommendation?.reason || "";
  const keys = { SNAPSHOT: ["readiness_status","readiness_score","next_best_action","business_fit"], SYNTHESIS: ["findings","qualification","recommendation"], RECOMMENDATION: ["priority","segment","personalization","recommendation"], PLAN: ["action_type","policy_decision","approval","execution_contract"] }[kind];
  return { title: titles[kind], summary: clip(summary,4000), fields: keys.filter(key => output[key] !== null && output[key] !== undefined).map(key => ({ label: key.replaceAll("_"," "), value: clip(output[key],4096) })), truncated };
}
export async function captureFeedbackTarget(tx, scope) {
  const { organization_id: org, lead_id: lead, target_kind: kind, target_id: id } = scope;
  assertWorkspaceTransaction(tx, org);
  const spec = TABLES[kind], params = [org,lead,id], where = " WHERE organization_id=? AND lead_id=? AND id=?";
  const meta = await tx.get("SELECT status," + sizeSql(tx,spec.columns) + " AS source_bytes FROM " + spec.table + where, params);
  if (!meta) throw feedbackError("FEEDBACK_TARGET_NOT_FOUND", "This saved target was not found in this workspace enquiry.",404);
  if (!(kind === "REPLY" ? ["RECEIVED"] : kind === "PLAN" ? ["PLANNED","BLOCKED","SUPERSEDED"] : ["READY","SUPERSEDED"]).includes(meta.status)) throw feedbackError("FEEDBACK_TARGET_INCOMPLETE","Review a completed saved output.",409);
  let bytes = Number(meta.source_bytes);
  if (bytes > MAX_TARGET_BYTES) throw tooLarge();
  const childPlans = [];
  if (kind === "SNAPSHOT") {
    let count = 0;
    for (const [table,columns] of Object.entries(CHILDREN)) {
      const m = await tx.get("SELECT count(*) n,COALESCE(SUM(" + sizeSql(tx,columns) + "),0) source_bytes FROM " + table + " WHERE organization_id=? AND lead_id=? AND snapshot_id=?", [org,lead,id]);
      count += Number(m.n); bytes += Number(m.source_bytes); if (count > 1000 || bytes > MAX_TARGET_BYTES) throw tooLarge();
      childPlans.push({table,columns});
    }
  }
  const row = await tx.get("SELECT " + spec.columns.join(",") + " FROM " + spec.table + where, params);
  let output = decoded(row), reply = null, children = null;
  if (kind === "SNAPSHOT") {
    children = {};
    for (const {table,columns} of childPlans) children[table] = (await tx.all("SELECT " + columns.join(",") + " FROM " + table + " WHERE organization_id=? AND lead_id=? AND snapshot_id=? ORDER BY id", [org,lead,id])).map(decoded);
  }
  if (kind === "REPLY") {
    if (row.direction !== "INBOUND" || !row.inbound_event_id) throw invalid();
    const cols = ["id","event_type","payload_json","received_at","channel"];
    const inboundMeta = await tx.get("SELECT " + sizeSql(tx,cols) + " source_bytes FROM inbound_events WHERE organization_id=? AND lead_id=? AND id=?", [org,lead,row.inbound_event_id]);
    if (!inboundMeta) throw invalid();
    if (bytes + Number(inboundMeta.source_bytes) > MAX_TARGET_BYTES) throw tooLarge();
    const inbound = await tx.get("SELECT " + cols.join(",") + " FROM inbound_events WHERE organization_id=? AND lead_id=? AND id=?", [org,lead,row.inbound_event_id]);
    const payload = parseFeedbackJson(inbound.payload_json);
    if (!payload || typeof payload !== "object" || Array.isArray(payload) || !REPLY_CATEGORIES.includes(inbound.event_type) || inbound.event_type !== row.classification_event_type || inbound.channel !== row.channel) throw invalid();
    const text = typeof payload.text === "string" && payload.text ? payload.text : typeof payload.transcript === "string" && payload.transcript ? payload.transcript : null;
    if (text !== null && text !== row.body) throw invalid();
    const interpretation = publicReplyInterpretation({ ...row, payload: { classification: payload.classification || null } });
    if (text && text.trim() && text.length <= 32768) reply = { text, recorded_category: inbound.event_type, generation: interpretation.generation };
    output = { message_id: row.id, inbound_event_id: inbound.id, channel: row.channel, occurred_at: row.occurred_at, recorded_category: inbound.event_type, classification: payload.classification || null, interpretation, original_body: text };
  }
  const identity = { kind, id, lead_id: lead, version: row.version ?? null, pipeline_version: row.pipeline_version ?? null, created_at: row.created_at };
  const snapshot = { version: 1, target: identity, output, children, reply };
  if (Buffer.byteLength(JSON.stringify(snapshot),"utf8") > MAX_TARGET_BYTES) throw tooLarge();
  const source_sha256 = feedbackHash(snapshot);
  const target = { ...identity, status: meta.status, source_sha256, presentation: presentation(kind,output,reply), evaluation_input_available: reply !== null };
  return { snapshot, source_sha256, target, typed_key: spec.key };
}
