import { instant } from "../business-context/businessContextContract.js";
import { fingerprint } from "./preparedActionContract.js";
export const COMPOSER_VERSION = "l4-02-composer-v1";
export const composerHash = fingerprint;
export function composerError(code,message,statusCode=409){return Object.assign(new Error(message),{code,statusCode});}
export function composerText(value,field,max=200){if(typeof value!=="string"||!value.trim()||value.length>max)throw composerError("COMPOSER_INVALID_INPUT",field+" must contain 1 to "+max+" characters.",400);return value.trim();}
export function normalizeComposerSchedule(value){
 if(value===null)return null;
 try{return instant(value,"scheduled_at");}catch{throw composerError("INVALID_SCHEDULE_TIME","Use a real ISO schedule with seconds and an explicit UTC offset.",400);}
}
export function normalizeComposerCopy(input){
 if(typeof input.subject!=="string"||!input.subject.trim()||input.subject.length>200||/[\r\n\u0000-\u001f\u007f]/.test(input.subject))throw composerError("COMPOSER_INVALID_INPUT","Subject must contain 1 to 200 characters on one line.",400);
 if(typeof input.body!=="string"||!input.body.trim()||input.body.length>10000||input.body.includes("\u0000"))throw composerError("COMPOSER_INVALID_INPUT","Body must contain 1 to 10000 characters without null characters.",400);
 return {subject:input.subject.trim(),body:input.body,scheduled_at:normalizeComposerSchedule(input.scheduled_at)};
}
export function normalizeComposerCommand(input,operation){
 const allowed=["organization_id","actor","request_key","reason","subject","body","scheduled_at",...(operation==="CREATE"?["lead_id","review_token","acknowledge_pending","kind","reply_to_message_id"]:["action_id","expected_revision_id"])];
 if(!input||typeof input!=="object"||Array.isArray(input)||Object.keys(input).some(key=>!allowed.includes(key)))throw composerError("COMPOSER_INVALID_INPUT","Only supported composer fields may be submitted.",400);
 const result={operation,request_key:composerText(input.request_key,"request_key"),reason:composerText(input.reason,"reason",2000),...normalizeComposerCopy(input)};
 if(operation==="CREATE"){
  if(!["NEW_MESSAGE","REPLY"].includes(input.kind)||typeof input.acknowledge_pending!=="boolean")throw composerError("COMPOSER_INVALID_INPUT","Choose a message kind and explicitly acknowledge existing work.",400);
  if(input.kind==="NEW_MESSAGE"&&input.reply_to_message_id!==null)throw composerError("COMPOSER_INVALID_INPUT","A new message cannot carry a reply reference.",400);
  Object.assign(result,{lead_id:composerText(input.lead_id,"lead_id"),kind:input.kind,reply_to_message_id:input.kind==="REPLY"?composerText(input.reply_to_message_id,"reply_to_message_id"):null,review_token:composerText(input.review_token,"review_token",64),acknowledge_pending:input.acknowledge_pending});
 }else Object.assign(result,{action_id:composerText(input.action_id,"action_id"),expected_revision_id:composerText(input.expected_revision_id,"expected_revision_id")});
 return result;
}
export function publicComposerCommand(row){if(!row)return null;return Object.fromEntries(["id","operation","action_id","resulting_revision_id","message_kind","reply_to_message_id","reason","created_at","created_by"].map(key=>[key,row[key]]));}
