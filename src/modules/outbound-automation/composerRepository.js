import { assertWorkspaceTransaction } from "../contact-policy/contactPolicyService.js";
import { composerError } from "./composerContract.js";
const bytes=(db,column)=>db.kind==="postgres"?"octet_length("+column+")":"length(CAST("+column+" AS BLOB))";
export class ComposerRepository{
 constructor(db){this.db=db;}
 async lead(org,id){
  const fields=["id","organization_id","name","email","phone","normalized_email","normalized_phone","company","source","import_batch_id","import_row_id","source_metadata_json","status","created_at","updated_at","archived_at","normalized_name_company_key"];
  const meta=await this.db.get("SELECT "+fields.map(key=>bytes(this.db,"COALESCE("+key+",'')")).join("+")+" bytes FROM leads WHERE organization_id=? AND id=?",[org,id]);
  if(!meta)throw composerError("LEAD_NOT_FOUND","Lead not found.",404);
  if(Number(meta.bytes)>1048576)throw composerError("COMPOSER_SOURCE_LIMIT","This enquiry exceeds the supported composer inspection limit.",413);
  return this.db.get("SELECT * FROM leads WHERE organization_id=? AND id=?",[org,id]);
 }
 async assertActionSize(org,id){
  const meta=await this.db.get("SELECT "+bytes(this.db,"payload_json")+" bytes FROM actions WHERE organization_id=? AND id=?",[org,id]);
  if(meta&&Number(meta.bytes)>262144)throw composerError("COMPOSER_SOURCE_LIMIT","This action exceeds the supported composer inspection limit.",413);
 }
 byRequest(org,key){return this.db.get("SELECT * FROM action_composer_commands WHERE organization_id=? AND request_key=?",[org,key]);}
 origin(org,action){return this.db.get("SELECT message_kind,reply_to_message_id FROM action_composer_commands WHERE organization_id=? AND action_id=? AND operation='CREATE' LIMIT 1",[org,action]);}
 async append(row){assertWorkspaceTransaction(this.db,row.organization_id);const keys=Object.keys(row);await this.db.run("INSERT INTO action_composer_commands("+keys.join(",")+") VALUES("+keys.map(()=>"?").join(",")+")",Object.values(row));}
 async revision(org,action,id){
  const meta=await this.db.get("SELECT "+bytes(this.db,"envelope_json")+" bytes FROM action_revisions WHERE organization_id=? AND action_id=? AND id=?",[org,action,id]);
  if(!meta||Number(meta.bytes)>65536)throw composerError("COMPOSER_STATE_INVALID","The recorded draft requires operational review.",503);
  const row=await this.db.get("SELECT id,revision,envelope_json,content_hash FROM action_revisions WHERE organization_id=? AND action_id=? AND id=?",[org,action,id]);
  return row;
 }
 async reply(org,lead,id){
  if(id===null)return null;
  const meta=await this.db.get("SELECT "+(bytes(this.db,"COALESCE(m.body,'')")+"+"+bytes(this.db,"COALESCE(m.subject,'')"))+" bytes FROM channel_messages m JOIN inbound_events e ON e.id=m.inbound_event_id AND e.organization_id=m.organization_id AND e.lead_id=m.lead_id AND e.channel=m.channel WHERE m.organization_id=? AND m.lead_id=? AND m.id=? AND m.direction='INBOUND' AND m.channel='EMAIL'",[org,lead,id]);
  if(!meta)throw composerError("COMPOSER_REPLY_UNAVAILABLE","Select an inbound email belonging to this enquiry.",404);
  if(Number(meta.bytes)>131072)throw composerError("COMPOSER_SOURCE_LIMIT","This reply exceeds the supported composer inspection limit.",413);
  const row=await this.db.get("SELECT m.id,m.subject,m.body,m.occurred_at,m.inbound_event_id FROM channel_messages m WHERE m.organization_id=? AND m.lead_id=? AND m.id=?",[org,lead,id]);
  if((row.body||"").length>32768||(row.subject!==null&&typeof row.subject!=="string")||(row.subject||"").length>1000)throw composerError("COMPOSER_SOURCE_LIMIT","This reply exceeds the supported composer inspection limit.",413);
  return row;
 }
 async pending(org,lead){
  const predicate="a.organization_id=? AND a.lead_id=? AND a.type='SEND_EMAIL' AND (a.status IN ('PLANNED','AWAITING_APPROVAL','APPROVED','RETRYING','EXECUTING') OR EXISTS (SELECT 1 FROM action_executions e WHERE e.action_id=a.id AND (e.outcome_class IS NULL OR e.outcome_class IN ('DISPATCHING','UNCERTAIN','LEGACY_UNKNOWN','CLOSED_UNRESOLVED'))))";
  const meta=await this.db.get("SELECT count(*) n,COALESCE(MAX(length(a.id)),0) max_id,COALESCE(MAX(length(a.current_revision_id)),0) max_revision FROM actions a WHERE "+predicate,[org,lead]);
  const count=Number(meta.n);
  if(Number(meta.max_id)>200||Number(meta.max_revision)>200)throw composerError("COMPOSER_SOURCE_LIMIT","Pending action identifiers exceed the supported inspection limit.",413);
  if(count>1000)throw composerError("COMPOSER_PENDING_LIMIT","More than 1000 pending email actions require operational review.",413);
  const rows=await this.db.all("SELECT a.id,a.status,a.current_revision_id,a.scheduled_at,a.execution_hold_reason,a.active_execution_id FROM actions a WHERE "+predicate+" ORDER BY a.id",[org,lead]);
  const publicRows=[];
  for(const row of rows.slice(0,20)){
   let subject=null;
   if(row.current_revision_id){const revision=await this.revision(org,row.id,row.current_revision_id);try{const envelope=JSON.parse(revision.envelope_json);subject=typeof envelope.subject==="string"?envelope.subject.slice(0,200):null;}catch{throw composerError("COMPOSER_STATE_INVALID","A pending draft requires operational review.",503);}}
   publicRows.push({id:row.id,status:row.status,current_revision_id:row.current_revision_id,scheduled_at:row.scheduled_at,subject});
  }
  return {rows,publicRows,total:count};
 }
}
