import { createId } from "../../shared/ids.js";
import { ContactPolicyService } from "../contact-policy/contactPolicyService.js";
import { AuditRepository } from "../events/auditRepository.js";
import { IntelligenceFeedbackRepository } from "./intelligenceFeedbackRepository.js";
import { captureFeedbackTarget } from "./feedbackTargetRepository.js";
import { feedbackObject,feedbackScope,feedbackInteger,feedbackText,feedbackHash,feedbackError,feedbackSummary,normalizeFeedbackLabels,requireFeedbackOwner,MAX_FEEDBACK_REVISIONS } from "./intelligenceFeedbackContract.js";
const SCOPE_KEYS=["organization_id","lead_id","target_kind","target_id","actor"];
export class IntelligenceFeedbackService {
  constructor(db,{now=Date.now}={}) { this.db=db;this.policy=new ContactPolicyService(db);this.now=now; }
  async review(input) {
    feedbackObject(input,SCOPE_KEYS);
    const scope=feedbackScope(input);
    return this.policy.withWorkspacePolicyTransaction(scope.organization_id,async tx=>{
      await requireFeedbackOwner(tx,scope.organization_id,scope.actor);
      return (await buildReview(tx,scope)).view;
    });
  }
  async history(input) {
    feedbackObject(input,[...SCOPE_KEYS,"before_revision","limit"],SCOPE_KEYS);
    const scope=feedbackScope(input),before=input.before_revision==null?null:feedbackInteger(input.before_revision,null,1),limit=feedbackInteger(input.limit,20,1,50);
    return this.policy.withWorkspacePolicyTransaction(scope.organization_id,async tx=>{
      await requireFeedbackOwner(tx,scope.organization_id,scope.actor);
      if (!await tx.get("SELECT id FROM leads WHERE organization_id=? AND id=?",[scope.organization_id,scope.lead_id])) throw feedbackError("FEEDBACK_TARGET_NOT_FOUND","The enquiry was not found.",404);
      const repository=new IntelligenceFeedbackRepository(tx),target=await repository.target(scope),head=target?await repository.latest(scope.organization_id,target.id):null;
      if (!target) await captureFeedbackTarget(tx,scope);
      return { feedback:feedbackSummary(head),history:await repository.history(scope.organization_id,target?.id,before,limit) };
    });
  }
  async byRequestKey(input) {
    feedbackObject(input,["organization_id","actor","request_key"]);
    const org=feedbackText(input.organization_id,"workspace"),key=feedbackText(input.request_key,"request key",200);
    return this.policy.withWorkspacePolicyTransaction(org,async tx=>{
      await requireFeedbackOwner(tx,org,input.actor);
      return { feedback:feedbackSummary(await new IntelligenceFeedbackRepository(tx).byRequest(org,key)) };
    });
  }
  async listCandidates(input) {
    feedbackObject(input,["organization_id","actor","after_feedback_id","limit"],["organization_id","actor"]);
    const org=feedbackText(input.organization_id,"workspace"),after=input.after_feedback_id===undefined?null:feedbackText(input.after_feedback_id,"feedback cursor"),limit=feedbackInteger(input.limit,20,1,50);
    return this.policy.withWorkspacePolicyTransaction(org,async tx=>{
      await requireFeedbackOwner(tx,org,input.actor);
      const rows=await tx.all("SELECT r.*,t.target_kind,t.target_id,substr(l.name,1,200) lead_name FROM intelligence_feedback_targets t JOIN intelligence_feedback_revisions r ON r.organization_id=t.organization_id AND r.feedback_id=t.id AND r.revision=(SELECT MAX(h.revision) FROM intelligence_feedback_revisions h WHERE h.organization_id=t.organization_id AND h.feedback_id=t.id) JOIN leads l ON l.organization_id=t.organization_id AND l.id=t.lead_id WHERE t.organization_id=? AND t.target_kind='REPLY' AND r.status='RECORDED' AND (r.labels_json LIKE '%\"eval_use\":\"SYNTHETIC\"%' OR r.labels_json LIKE '%\"eval_use\":\"PERMISSION_REVIEWED\"%')"+(after?" AND t.id>?":"")+" ORDER BY t.id LIMIT ?",[org,...(after?[after]:[]),limit+1]);
      const items=rows.slice(0,limit).map(row=>({...feedbackSummary(row),lead_id:row.lead_id,lead_name:row.lead_name,target_kind:row.target_kind,target_id:row.target_id}));
      return { items,limit,has_more:rows.length>limit,next_after_feedback_id:rows.length>limit?items.at(-1).id:null };
    });
  }
  async record(input) {
    feedbackObject(input,[...SCOPE_KEYS,"expected_feedback_revision","review_token","request_key","operation","labels","reason"]);
    const scope=feedbackScope(input),expected=feedbackInteger(input.expected_feedback_revision,undefined,0,MAX_FEEDBACK_REVISIONS),key=feedbackText(input.request_key,"request key",200),reason=feedbackText(input.reason,"review reason",2000);
    if (!["RECORD","WITHDRAW"].includes(input.operation) || typeof input.review_token!=="string" || !/^[0-9a-f]{64}$/.test(input.review_token)) throw feedbackError("FEEDBACK_INVALID_INPUT","Provide the reviewed target token and operation.");
    const labels=input.operation==="RECORD"?normalizeFeedbackLabels(input.labels,scope.target_kind):null;
    if (input.operation==="WITHDRAW" && input.labels!==null) throw feedbackError("FEEDBACK_INVALID_INPUT","Withdrawal does not replace the saved labels.");
    const hash=feedbackHash({version:1,organization_id:scope.organization_id,lead_id:scope.lead_id,target_kind:scope.target_kind,target_id:scope.target_id,actor_id:scope.actor?.id,expected_feedback_revision:expected,review_token:input.review_token,request_key:key,operation:input.operation,labels,reason});
    return this.policy.withWorkspacePolicyTransaction(scope.organization_id,async tx=>{
      await requireFeedbackOwner(tx,scope.organization_id,scope.actor);
      const repository=new IntelligenceFeedbackRepository(tx),prior=await repository.byRequest(scope.organization_id,key);
      if (prior) {
        if (prior.request_hash!==hash) throw feedbackError("FEEDBACK_REQUEST_CONFLICT","This request key already records a different review.",409);
        return { feedback:feedbackSummary(prior),replayed:true };
      }
      const review=await buildReview(tx,scope);
      if ((review.head?.revision||0)!==expected) throw feedbackError("FEEDBACK_REVISION_STALE","A newer feedback revision exists. Review it before saving.",409);
      if (!review.view.can_record) throw feedbackError(review.view.unavailable_reason,"This saved target cannot accept another review.",409);
      if (review.view.review_token!==input.review_token) throw feedbackError("FEEDBACK_REVIEW_STALE","The exact saved target changed. Load and review it again.",409);
      if (input.operation==="WITHDRAW" && review.head?.status!=="RECORDED") throw feedbackError("FEEDBACK_INVALID_INPUT","Only an active recorded review can be withdrawn.");
      if (labels?.eval_use!=="OPERATIONAL_ONLY" && labels!==null && !review.capture.snapshot.reply) throw feedbackError("FEEDBACK_EVALUATION_INPUT_REQUIRED","Evaluation nomination requires the intact original reply input.",409);
      const timestamp=new Date(this.now()).toISOString(),feedbackId=review.targetRow?.id||createId("feedback");
      if (!review.targetRow) {
        const target={id:feedbackId,organization_id:scope.organization_id,lead_id:scope.lead_id,target_kind:scope.target_kind,target_id:scope.target_id,snapshot_id:null,synthesis_id:null,recommendation_id:null,plan_id:null,message_id:null,source_sha256:review.capture.source_sha256,snapshot_json:JSON.stringify(review.capture.snapshot),created_at:timestamp,created_by:scope.actor.id};
        target[review.capture.typed_key]=scope.target_id;
        await repository.appendTarget(target);
      }
      const row={id:createId("feedback_revision"),organization_id:scope.organization_id,lead_id:scope.lead_id,feedback_id:feedbackId,revision:expected+1,expected_revision:expected,status:input.operation==="WITHDRAW"?"WITHDRAWN":"RECORDED",labels_json:labels===null?null:JSON.stringify(labels),reason,request_key:key,request_hash:hash,created_at:timestamp,created_by:scope.actor.id};
      await repository.appendRevision(row);
      await new AuditRepository(tx).record({organization_id:scope.organization_id,lead_id:scope.lead_id,event_type:input.operation==="WITHDRAW"?"IntelligenceFeedbackWithdrawn":"IntelligenceFeedbackRecorded",message:input.operation==="WITHDRAW"?"Owner withdrew a saved intelligence review.":"Owner reviewed an exact saved intelligence result.",metadata:{feedback_id:feedbackId,revision:row.revision,target_kind:scope.target_kind,target_id:scope.target_id,actor:scope.actor.id}});
      return { feedback:feedbackSummary({...row,target_kind:scope.target_kind}),replayed:false };
    });
  }
}
async function buildReview(tx,scope) {
  const repository=new IntelligenceFeedbackRepository(tx),targetRow=await repository.target(scope),head=targetRow?await repository.latest(scope.organization_id,targetRow.id):null;
  let capture=null,unavailable=null;
  try { capture=await captureFeedbackTarget(tx,scope); }
  catch(error) { if (!["FEEDBACK_TARGET_INCOMPLETE","FEEDBACK_TARGET_TOO_LARGE","FEEDBACK_TARGET_INVALID"].includes(error.code)) throw error; unavailable=error.code; }
  if (targetRow && capture && targetRow.source_sha256!==capture.source_sha256) unavailable="FEEDBACK_REVIEW_STALE";
  if ((head?.revision||0)>=MAX_FEEDBACK_REVISIONS) unavailable="FEEDBACK_REVISION_LIMIT";
  const target=capture?.target || {kind:scope.target_kind,id:scope.target_id,lead_id:scope.lead_id,status:"UNAVAILABLE",created_at:null,version:null,pipeline_version:null,source_sha256:null,evaluation_input_available:false,presentation:{title:"Saved intelligence result",summary:"The complete saved target is unavailable for review.",fields:[],truncated:false}};
  const review_token=unavailable?null:feedbackHash({version:1,organization_id:scope.organization_id,lead_id:scope.lead_id,target_kind:scope.target_kind,target_id:scope.target_id,source_sha256:capture.source_sha256,feedback_revision:head?.revision||0});
  return {capture,targetRow,head,view:{target,review_token,feedback:feedbackSummary(head),history:await repository.history(scope.organization_id,targetRow?.id),can_record:unavailable===null,unavailable_reason:unavailable}};
}
