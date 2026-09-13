import { instant,normalizeMoney } from "../business-context/businessContextContract.js";
import { fingerprint } from "../outbound-automation/preparedActionContract.js";
export const workflowHash=fingerprint;
export const OUTCOME_KINDS=["QUALIFIED_CONVERSATION","MEETING_BOOKED","QUOTE_REQUESTED","WON","LOST"];
export function workflowError(code,message,statusCode=409){return Object.assign(new Error(message),{code,statusCode});}
export function text(value,field,max=200){if(typeof value!=="string"||!value.trim()||value.length>max||value.includes("\u0000"))throw workflowError("CUSTOMER_WORKFLOW_INVALID_INPUT",field+" must contain 1 to "+max+" characters.",400);return value.trim();}
export function optionalText(value,field,max=200){return value===null?null:text(value,field,max);}
export function exact(value,keys){if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key)))throw workflowError("CUSTOMER_WORKFLOW_INVALID_INPUT","Only supported fields may be supplied.",400);}
export function integer(value,field,{min=0,max=2147483647,query=false}={}){if(query&&typeof value==="string"&&/^(0|[1-9]\d*)$/.test(value))value=Number(value);if(!Number.isSafeInteger(value)||value<min||value>max)throw workflowError("CUSTOMER_WORKFLOW_INVALID_INPUT",field+" must be a supported integer.",400);return value;}
export function paging(input){return {limit:input.limit===undefined?20:integer(input.limit,"limit",{min:1,max:50,query:true}),after:input.after_id==null?null:text(input.after_id,"after_id"),before:input.before_revision==null?null:integer(input.before_revision,"before_revision",{min:1,query:true})};}
export function time(value){try{return instant(value,"time");}catch{throw workflowError("CUSTOMER_WORKFLOW_INVALID_INPUT","Supply a real date/time with seconds and an explicit UTC offset.",400);}}
export function command(input,operation){return {operation,request_key:text(input.request_key,"request_key"),reason:text(input.reason,"reason",2000)};}
export function outcomeSlot(kind){return ["WON","LOST"].includes(kind)?"RESULT":kind;}
export function normalizeOutcome(values,now){
 exact(values,["kind","occurred_at","summary","source_reference","evidence_message_id","attributed_action_id","attribution_note","amount"]);
 if(!OUTCOME_KINDS.includes(values.kind))throw workflowError("CUSTOMER_WORKFLOW_INVALID_INPUT","Choose a supported outcome milestone.",400);
 const result={kind:values.kind,occurred_at:time(values.occurred_at),summary:text(values.summary,"summary",2000),source_reference:optionalText(values.source_reference,"source_reference",500),evidence_message_id:optionalText(values.evidence_message_id,"evidence_message_id"),attributed_action_id:optionalText(values.attributed_action_id,"attributed_action_id"),attribution_note:optionalText(values.attribution_note,"attribution_note",2000),amount:null};
 if(Boolean(result.attributed_action_id)!==Boolean(result.attribution_note))throw workflowError("CUSTOMER_WORKFLOW_INVALID_INPUT","An attributed action requires a separate explicit attribution note.",400);
 if(values.amount!==null){
  if(values.kind!=="WON")throw workflowError("CUSTOMER_WORKFLOW_INVALID_INPUT","Only a won outcome can carry reported deal value.",400);
  exact(values.amount,["currency","value"]);let amount;
  try{amount=normalizeMoney({currency:values.amount.currency,minimum:values.amount.value,maximum:values.amount.value});}catch{throw workflowError("CUSTOMER_WORKFLOW_INVALID_INPUT","Use a supported currency and an exact unsigned decimal string.",400);}
  result.amount={currency:amount.currency,scale:amount.scale,minor_units:amount.minimum_minor};
 }
 return result;
}
export function parseJson(value,cap=16384){try{if(typeof value!=="string"||Buffer.byteLength(value,"utf8")>cap)throw new Error();return JSON.parse(value);}catch{throw workflowError("CUSTOMER_WORKFLOW_STATE_INVALID","Saved workflow history requires operational inspection.",503);}}
export function encode(value,cap=16384){const json=JSON.stringify(value);if(Buffer.byteLength(json,"utf8")>cap)throw workflowError("CUSTOMER_WORKFLOW_LIMIT","Workflow history exceeds its supported byte limit.",413);return json;}
export function taskOrigin(task){return task.idempotency_key?.startsWith("manual-reminder:")?"MANUAL_REMINDER":task.action_id&&task.idempotency_key==="action:"+task.action_id+":no-response-follow-up:v1"?"AUTOMATIC_NO_RESPONSE":task.inbound_event_id?"INBOUND_REVIEW":"LEGACY";}
export function publicTask(row){if(!row)return null;const origin=taskOrigin(row);return {...Object.fromEntries(["id","lead_id","action_id","inbound_event_id","channel","status","due_at","reason","escalated","created_at","updated_at","completed_at"].map(key=>[key,row[key]])),origin,state_token:workflowHash(row),can_reschedule:origin!=="AUTOMATIC_NO_RESPONSE"&&["PLANNED","DUE","BLOCKED"].includes(row.status)};}
export function publicConversationRevision(row){if(!row)return null;return Object.fromEntries(["id","lead_id","revision","status","assigned_owner_id","forced_unread","last_inbound_message_id","inbound_count","reason","created_at","created_by"].map(key=>[key,row[key]]));}
export function publicFollowUpCommand(row){return {id:row.id,operation:row.operation,follow_up_id:row.follow_up_id,before:row.before_json?publicTask(parseJson(row.before_json)):null,after:publicTask(parseJson(row.after_json)),reason:row.reason,created_at:row.created_at,created_by:row.created_by};}
export function publicOutcome(row,slot){if(!row)return null;return {id:row.outcome_id,revision_id:row.id,lead_id:row.lead_id,slot,revision:row.revision,status:row.status,values:{kind:row.kind,occurred_at:row.occurred_at,summary:row.summary,source_reference:row.source_reference,evidence_message_id:row.evidence_message_id,attributed_action_id:row.attributed_action_id,attribution_note:row.attribution_note,amount:row.amount_json?storedAmount(row.amount_json):null},reason:row.reason,created_at:row.created_at,created_by:row.created_by};}

function storedAmount(value){try{const amount=parseJson(value,1024);exact(amount,["currency","scale","minor_units"]);const normalized=normalizeMoney({currency:amount.currency,scale:amount.scale,minimum_minor:amount.minor_units,maximum_minor:amount.minor_units});return {currency:normalized.currency,scale:normalized.scale,minor_units:normalized.minimum_minor};}catch{throw workflowError("CUSTOMER_WORKFLOW_STATE_INVALID","Recorded outcome value cannot be verified.",503);}}
