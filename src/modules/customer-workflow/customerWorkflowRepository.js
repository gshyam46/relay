import { assertWorkspaceTransaction } from "../contact-policy/contactPolicyService.js";
import { workflowError,workflowHash } from "./customerWorkflowContract.js";
const TABLES={CONVERSATION:"conversation_revisions",FOLLOW_UP:"follow_up_commands",OUTCOME:"business_outcome_revisions"};
export const sqlBytes=(db,column)=>"COALESCE("+(db.kind==="postgres"?"octet_length("+column+")":"length(CAST("+column+" AS BLOB))")+",0)";
export class CustomerWorkflowRepository{
 constructor(db){this.db=db;}
 async lead(org,id){
  const columns=["name","email","phone","normalized_email","normalized_phone","company","source_metadata_json"];
  const meta=await this.db.get("SELECT "+columns.map(c=>sqlBytes(this.db,c)).join("+")+" bytes FROM leads WHERE organization_id=? AND id=?",[org,id]);
  if(!meta)throw workflowError("LEAD_NOT_FOUND","Enquiry not found.",404);
  if(Number(meta.bytes)>1048576)throw workflowError("CUSTOMER_WORKFLOW_LIMIT","This enquiry exceeds supported workflow inspection limits.",413);
  return this.db.get("SELECT id,organization_id,substr(name,1,200) name,status,archived_at,data_revision FROM leads WHERE organization_id=? AND id=?",[org,id]);
 }
 leadToken(lead){return workflowHash({version:"customer-workflow-lead-v1",lead});}
 async inbound(org,lead){
  const from=" FROM channel_messages m JOIN inbound_events e ON e.organization_id=m.organization_id AND e.lead_id=m.lead_id AND e.id=m.inbound_event_id AND e.channel=m.channel WHERE m.organization_id=? AND m.lead_id=? AND m.direction='INBOUND'";
  const count=Number((await this.db.get("SELECT count(*) n"+from,[org,lead])).n);
  if(!Number.isSafeInteger(count))throw workflowError("CUSTOMER_WORKFLOW_STATE_INVALID","Inbound observation count cannot be verified.",503);
  const last=await this.db.get("SELECT m.id,m.inbound_event_id,m.created_at,m.occurred_at,e.event_type"+from+" ORDER BY m.created_at DESC,m.id DESC LIMIT 1",[org,lead]);
  return {count,last:last||null,token:workflowHash({organization_id:org,lead_id:lead,count,last:last||null})};
 }
 async messagePage(org,lead,after,limit){
  let cursor=null;
  if(after!==null){cursor=await this.db.get("SELECT id,created_at FROM channel_messages WHERE organization_id=? AND lead_id=? AND id=?",[org,lead,after]);if(!cursor)throw workflowError("CUSTOMER_WORKFLOW_MESSAGE_UNAVAILABLE","Message cursor does not belong to this enquiry.",404);}
  const columns=["id","lead_id","action_id","inbound_event_id","direction","channel","status","subject","body","occurred_at","created_at"];
  const rows=await this.db.all("SELECT id,"+columns.map(c=>sqlBytes(this.db,c)).join("+")+" content_bytes FROM channel_messages WHERE organization_id=? AND lead_id=?"+(cursor?" AND (created_at<? OR (created_at=? AND id<?))":"")+" ORDER BY created_at DESC,id DESC LIMIT ?",[org,lead,...(cursor?[cursor.created_at,cursor.created_at,cursor.id]:[]),limit+1]);
  return rows;
 }
 async message(org,lead,id){
  return this.db.get("SELECT id,lead_id,action_id,inbound_event_id,direction,channel,status,subject,body,occurred_at,created_at,classification_event_type,classification_confidence,CASE WHEN "+sqlBytes(this.db,"payload_json")+"<=262144 THEN payload_json ELSE NULL END payload_json FROM channel_messages WHERE organization_id=? AND lead_id=? AND id=?",[org,lead,id]);
 }
 async canonicalMessage(org,lead,id){if(id===null)return null;const row=await this.db.get("SELECT m.id,m.inbound_event_id FROM channel_messages m JOIN inbound_events e ON e.organization_id=m.organization_id AND e.lead_id=m.lead_id AND e.id=m.inbound_event_id AND e.channel=m.channel WHERE m.organization_id=? AND m.lead_id=? AND m.id=? AND m.direction='INBOUND'",[org,lead,id]);if(!row)throw workflowError("CUSTOMER_WORKFLOW_MESSAGE_UNAVAILABLE","Select a canonical inbound message from this enquiry.",404);return row;}
 headConversation(org,lead){return this.db.get("SELECT * FROM conversation_revisions WHERE organization_id=? AND lead_id=? ORDER BY revision DESC LIMIT 1",[org,lead]);}
 historyConversation(org,lead,before,limit){return this.db.all("SELECT * FROM conversation_revisions WHERE organization_id=? AND lead_id=?"+(before===null?"":" AND revision<?")+" ORDER BY revision DESC LIMIT ?",[org,lead,...(before===null?[]:[before]),limit+1]);}
 byRequest(kind,org,key){if(!TABLES[kind])throw workflowError("CUSTOMER_WORKFLOW_INVALID_INPUT","Choose a supported recovery kind.",400);return this.db.get("SELECT * FROM "+TABLES[kind]+" WHERE organization_id=? AND request_key=?",[org,key]);}
 async append(table,row){if(![...Object.values(TABLES),"business_outcomes"].includes(table))throw new TypeError("Unknown workflow table.");assertWorkspaceTransaction(this.db,row.organization_id);const keys=Object.keys(row);await this.db.run("INSERT INTO "+table+"("+keys.join(",")+") VALUES("+keys.map(()=>"?").join(",")+")",Object.values(row));}
 async task(org,id){
  const cols=["id","organization_id","lead_id","action_id","inbound_event_id","channel","status","due_at","reason","idempotency_key","created_at","updated_at","completed_at"];
  const meta=await this.db.get("SELECT "+cols.map(c=>sqlBytes(this.db,c)).join("+")+" bytes FROM follow_up_tasks WHERE organization_id=? AND id=?",[org,id]);
  if(!meta)throw workflowError("FOLLOW_UP_NOT_FOUND","Follow-up not found.",404);
  if(Number(meta.bytes)>12000)throw workflowError("CUSTOMER_WORKFLOW_LIMIT","This follow-up exceeds supported inspection limits.",413);
  return this.db.get("SELECT * FROM follow_up_tasks WHERE organization_id=? AND id=?",[org,id]);
 }
 outcome(org,id){return this.db.get("SELECT * FROM business_outcomes WHERE organization_id=? AND id=?",[org,id]);}
 outcomeSlot(org,lead,slot){return this.db.get("SELECT * FROM business_outcomes WHERE organization_id=? AND lead_id=? AND slot=?",[org,lead,slot]);}
 headOutcome(org,id){return this.db.get("SELECT * FROM business_outcome_revisions WHERE organization_id=? AND outcome_id=? ORDER BY revision DESC LIMIT 1",[org,id]);}
 historyOutcome(org,id,before,limit){return this.db.all("SELECT * FROM business_outcome_revisions WHERE organization_id=? AND outcome_id=?"+(before===null?"":" AND revision<?")+" ORDER BY revision DESC LIMIT ?",[org,id,...(before===null?[]:[before]),limit+1]);}
}
