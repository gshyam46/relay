import { assertWorkspaceTransaction } from "../contact-policy/contactPolicyService.js";
import { emailConnectionError,emailChangeSummary,parseEmailConnectionJson,MAX_EMAIL_SETTINGS_BYTES,isValidEmailRouteToken } from "./emailConnectionContract.js";
const bytes=(db,column)=>db.kind==="postgres"?"octet_length("+column+")":"length(CAST("+column+" AS BLOB))";
export class EmailConnectionRepository{
 constructor(db){this.db=db;}
 async settings(org){
  const meta=await this.db.get("SELECT count(*) n,COALESCE(SUM("+bytes(this.db,"value")+"+"+bytes(this.db,"key")+"),0) bytes,COALESCE(MAX(length(key)),0) max_key FROM organization_settings WHERE organization_id=? AND category='channel_email'",[org]);
  assertSettingsBudget(meta);
  const rows=await this.db.all("SELECT key,value FROM organization_settings WHERE organization_id=? AND category='channel_email' ORDER BY key",[org]);
  return Object.fromEntries(rows.map(row=>[row.key,parseEmailConnectionJson(row.value,MAX_EMAIL_SETTINGS_BYTES)]));
 }
 async assertProposedSettings(org,updates){
  assertWorkspaceTransaction(this.db,org);
  // Preserve exact SQL byte sizes for untouched legacy values. Re-serializing
  // parsed legacy JSON here could hide retained whitespace or escape overhead.
  const rows=await this.db.all("SELECT key,"+bytes(this.db,"value")+"+"+bytes(this.db,"key")+" stored_bytes,length(key) key_length FROM organization_settings WHERE organization_id=? AND category='channel_email' LIMIT 33",[org]);
  const proposed=new Map(rows.map(row=>[row.key,{bytes:Number(row.stored_bytes),key_length:Number(row.key_length)}]));
  for(const [key,value] of Object.entries(updates)){
   const serialized=JSON.stringify(value);
   if(typeof serialized!=="string")throw emailConnectionError("EMAIL_CONNECTION_STATE_INVALID","Proposed email configuration cannot be stored safely.",503);
   proposed.set(key,{bytes:Buffer.byteLength(key,"utf8")+Buffer.byteLength(serialized,"utf8"),key_length:[...key].length});
  }
  assertSettingsBudget({n:proposed.size,bytes:[...proposed.values()].reduce((sum,row)=>sum+row.bytes,0),max_key:Math.max(0,...[...proposed.values()].map(row=>row.key_length))});
 }
 latest(org){return this.db.get("SELECT * FROM email_connection_revisions WHERE organization_id=? ORDER BY revision DESC LIMIT 1",[org]);}
 byRequest(org,key){return this.db.get("SELECT * FROM email_connection_revisions WHERE organization_id=? AND request_key=?",[org,key]);}
 async routes(org){
  const rows=await this.db.all("SELECT id,token,route_kind,created_revision FROM email_webhook_routes WHERE organization_id=? ORDER BY created_revision DESC,id DESC LIMIT 12",[org]);
  if(rows.length>11||rows.filter(row=>row.route_kind==="GENERATED").length>10||rows.filter(row=>row.route_kind==="LEGACY").length>1||rows.some(row=>!isValidEmailRouteToken(row.token)))throw emailConnectionError("EMAIL_CONNECTION_STATE_INVALID","Saved routing aliases require operational inspection.",503);
  return rows;
 }
 async history(org,before=null,limit=20){
  const rows=await this.db.all("SELECT * FROM email_connection_revisions WHERE organization_id=?"+(before===null?"":" AND revision<?")+" ORDER BY revision DESC LIMIT ?",[org,...(before===null?[]:[before]),limit+1]);
  const changes=rows.slice(0,limit).map(emailChangeSummary),has_more=rows.length>limit;
  return {changes,has_more,next_before_revision:has_more?changes.at(-1).revision:null};
 }
 async appendChange(row){assertWorkspaceTransaction(this.db,row.organization_id);const keys=Object.keys(row);await this.db.run("INSERT INTO email_connection_revisions("+keys.join(",")+") VALUES("+keys.map(()=>"?").join(",")+")",Object.values(row));}
 async appendRoute(row){assertWorkspaceTransaction(this.db,row.organization_id);const keys=Object.keys(row);await this.db.run("INSERT INTO email_webhook_routes("+keys.join(",")+") VALUES("+keys.map(()=>"?").join(",")+")",Object.values(row));}
}
export async function emailRouteOwners(db,token){
 if(!isValidEmailRouteToken(token))throw emailConnectionError("CHANNEL_ROUTE_INVALID","Webhook routing token is invalid.",404);
 const rows=await db.all("SELECT organization_id FROM email_webhook_routes WHERE token=? UNION SELECT organization_id FROM organization_settings WHERE category='channel_email' AND key='webhook_token' AND value=? LIMIT 2",[token,JSON.stringify(token)]);
 if(rows.length>1)throw emailConnectionError("CHANNEL_ROUTE_AMBIGUOUS","Webhook routing ownership requires operational inspection.",409);
 return rows.map(row=>row.organization_id);
}

function assertSettingsBudget(meta){if(Number(meta.n)>32||Number(meta.bytes)>MAX_EMAIL_SETTINGS_BYTES||Number(meta.max_key)>200)throw emailConnectionError("EMAIL_CONNECTION_SETTINGS_LIMIT","Email configuration exceeds the supported inspection limit.",413);}
