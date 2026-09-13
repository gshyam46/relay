import { assertWorkspaceTransaction } from "../contact-policy/contactPolicyService.js";
import { byteLengthSql, feedbackSummary, parseFeedbackJson, feedbackHash, feedbackError } from "./intelligenceFeedbackContract.js";
export class IntelligenceFeedbackRepository {
  constructor(db) { this.db = db; }
  target(scope) { return this.db.get("SELECT id,organization_id,lead_id,target_kind,target_id,source_sha256 FROM intelligence_feedback_targets WHERE organization_id=? AND lead_id=? AND target_kind=? AND target_id=?", [scope.organization_id,scope.lead_id,scope.target_kind,scope.target_id]); }
  latest(org,id) { return this.db.get("SELECT r.*,t.target_kind FROM intelligence_feedback_revisions r JOIN intelligence_feedback_targets t ON t.organization_id=r.organization_id AND t.id=r.feedback_id WHERE r.organization_id=? AND r.feedback_id=? ORDER BY r.revision DESC LIMIT 1", [org,id]); }
  byRequest(org,key) { return this.db.get("SELECT r.*,t.target_kind,t.target_id FROM intelligence_feedback_revisions r JOIN intelligence_feedback_targets t ON t.organization_id=r.organization_id AND t.id=r.feedback_id WHERE r.organization_id=? AND r.request_key=?", [org,key]); }
  async history(org,id,before=null,limit=20) {
    if (!id) return { changes:[],has_more:false,next_before_revision:null };
    const rows = await this.db.all("SELECT r.*,t.target_kind FROM intelligence_feedback_revisions r JOIN intelligence_feedback_targets t ON t.organization_id=r.organization_id AND t.id=r.feedback_id WHERE r.organization_id=? AND r.feedback_id=?" + (before === null ? "" : " AND r.revision<?") + " ORDER BY r.revision DESC LIMIT ?", [org,id,...(before === null ? [] : [before]),limit+1]);
    const changes = rows.slice(0,limit).map(feedbackSummary), has_more=rows.length>limit;
    return { changes,has_more,next_before_revision:has_more ? changes.at(-1).revision : null };
  }
  async appendTarget(record) { assertWorkspaceTransaction(this.db,record.organization_id); const keys=Object.keys(record); await this.db.run("INSERT INTO intelligence_feedback_targets("+keys.join(",")+") VALUES("+keys.map(()=>"?").join(",")+")",Object.values(record)); }
  async appendRevision(record) { assertWorkspaceTransaction(this.db,record.organization_id); const keys=Object.keys(record); await this.db.run("INSERT INTO intelligence_feedback_revisions("+keys.join(",")+") VALUES("+keys.map(()=>"?").join(",")+")",Object.values(record)); }
}
export async function loadEvaluationFeedback(tx,{organization_id,feedback_id,revision,metadataOnly=false}) {
  assertWorkspaceTransaction(tx,organization_id);
  const row = await tx.get("SELECT r.feedback_id,r.revision,r.lead_id,r.status,r.created_at,r.created_by,t.target_kind,t.target_id,t.source_sha256,"+byteLengthSql(tx,"t.snapshot_json")+" snapshot_bytes,h.revision latest_revision,h.status latest_status,h.labels_json latest_labels_json"+(metadataOnly?"":",r.labels_json,t.snapshot_json")+" FROM intelligence_feedback_revisions r JOIN intelligence_feedback_targets t ON t.organization_id=r.organization_id AND t.id=r.feedback_id AND t.lead_id=r.lead_id JOIN intelligence_feedback_revisions h ON h.organization_id=r.organization_id AND h.feedback_id=r.feedback_id AND h.revision=(SELECT MAX(x.revision) FROM intelligence_feedback_revisions x WHERE x.organization_id=r.organization_id AND x.feedback_id=r.feedback_id) WHERE r.organization_id=? AND r.feedback_id=? AND r.revision=?", [organization_id,feedback_id,revision]);
  if (!row) throw feedbackError("FEEDBACK_TARGET_NOT_FOUND","The saved feedback revision was not found.",404);
  const latestLabels = row.latest_labels_json === null ? null : parseFeedbackJson(row.latest_labels_json,4096);
  const result = { feedback_id:row.feedback_id,revision:row.revision,lead_id:row.lead_id,status:row.status,target_kind:row.target_kind,target_id:row.target_id,source_sha256:row.source_sha256,created_at:row.created_at,created_by:row.created_by,latest_revision:row.latest_revision,latest_status:row.latest_status,latest_eval_use:latestLabels?.eval_use || null,snapshot_bytes:Number(row.snapshot_bytes) };
  if (metadataOnly) return result;
  const snapshot = parseFeedbackJson(row.snapshot_json);
  if (feedbackHash(snapshot)!==row.source_sha256 || snapshot.version!==1 || snapshot.target?.kind!==row.target_kind || snapshot.target?.id!==row.target_id || snapshot.target?.lead_id!==row.lead_id) throw feedbackError("FEEDBACK_TARGET_INVALID","Saved evaluation source requires operational inspection.",409);
  return { ...result,labels:row.labels_json===null?null:parseFeedbackJson(row.labels_json,4096),reply:snapshot.reply || null };
}
