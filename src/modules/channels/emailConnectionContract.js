import { createHash, createPublicKey } from "node:crypto";
export const EMAIL_EDITABLE_FIELDS=["provider","from_email","reply_to","api_key","sendgrid_events_public_key","sendgrid_inbound_public_key"];
export const EMAIL_SECRET_MASK="********";
export const MAX_EMAIL_CHANGES=100,MAX_GENERATED_ROUTES=10,MAX_EMAIL_SETTINGS_BYTES=65536;
export function emailConnectionError(code,message,statusCode=400){return Object.assign(new Error(message),{code,statusCode});}
export function emailConnectionHash(value){return createHash("sha256").update(canonical(value)).digest("hex");}
export function emailConnectionObject(value,allowed,required=allowed){if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).some(key=>!allowed.includes(key))||required.some(key=>!Object.hasOwn(value,key)))throw emailConnectionError("EMAIL_CONNECTION_INVALID_INPUT","Provide only the supported email connection fields.");}
export function emailConnectionText(value,name,max=256){if(typeof value!=="string"||!value.trim()||value.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))throw emailConnectionError("EMAIL_CONNECTION_INVALID_INPUT","Provide a valid "+name+".");return value.trim();}
export function emailConnectionInteger(value,fallback,min=0,max=100){if(value===undefined)return fallback;if(typeof value==="string"&&/^(0|[1-9][0-9]*)$/.test(value))value=Number(value);if(!Number.isSafeInteger(value)||value<min||value>max)throw emailConnectionError("EMAIL_CONNECTION_INVALID_INPUT","Provide a valid connection revision or history limit.");return value;}
export function isValidEmailMailbox(value){
 if(typeof value!=="string"||value.length>254||value!==value.trim()||/[^\x21-\x7e]/.test(value))return false;
 const parts=value.split("@");if(parts.length!==2)return false;const [local,domain]=parts;
 return local.length>0&&local.length<=64&&!local.startsWith(".")&&!local.endsWith(".")&&!local.includes("..")&&/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)&&domain.includes(".")&&domain.split(".").every(label=>label.length>0&&label.length<=63&&/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label));
}
function publicKey(value){
 if(typeof value!=="string"||!value.trim()||value.length>8192)throw new Error("Invalid public key");
 const clean=value.trim();let key;
 if(clean.startsWith("-----BEGIN PUBLIC KEY-----"))key=createPublicKey(clean);
 else {if(!/^[A-Za-z0-9+/=\r\n]+$/.test(clean))throw new Error("Invalid public key");key=createPublicKey({key:Buffer.from(clean,"base64"),format:"der",type:"spki"});}
 if(key.asymmetricKeyType!=="ec"||key.asymmetricKeyDetails?.namedCurve!=="prime256v1")throw new Error("Unsupported public key");return key;
}
export function isValidSendgridPublicKey(value){try{publicKey(value);return true;}catch{return false;}}
function validSecret(value){return typeof value==="string"&&value.trim().length>0&&value.length<=4096&&value!==EMAIL_SECRET_MASK&&!/[\x00-\x20\x7f]/.test(value);}
export function assessEmailConfiguration(config){
 const provider=config?.provider||"sandbox",missing_fields=[],invalid_fields=[];
 if(provider==="sandbox")return {complete:true,missing_fields,invalid_fields};
 if(provider!=="sendgrid")return {complete:false,missing_fields,invalid_fields:["provider"]};
 for(const field of EMAIL_EDITABLE_FIELDS.slice(1)){const value=config?.[field];if(value===undefined||value===null||value==="")missing_fields.push(field);else if(field==="api_key"?!validSecret(value):field.endsWith("public_key")?!isValidSendgridPublicKey(value):!isValidEmailMailbox(value))invalid_fields.push(field);}
 return {complete:!missing_fields.length&&!invalid_fields.length,missing_fields,invalid_fields};
}
export function normalizeEmailConnectionValues(values,current){
 emailConnectionObject(values,EMAIL_EDITABLE_FIELDS);
 if(!["sandbox","sendgrid"].includes(values.provider))throw emailConnectionError("EMAIL_CONNECTION_INVALID_INPUT","Choose Sandbox or SendGrid.");
 const result={provider:values.provider};
 for(const field of EMAIL_EDITABLE_FIELDS.slice(1)){
  const input=values[field];if(typeof input!=="string")throw emailConnectionError("EMAIL_CONNECTION_INVALID_INPUT","Connection fields must be explicit strings; use an empty value to clear.");
  if(field==="api_key"){if(input===EMAIL_SECRET_MASK){result[field]=typeof current.api_key==="string"?current.api_key:"";continue;}if(input!==""&&!validSecret(input))throw emailConnectionError("EMAIL_CONNECTION_INVALID_INPUT","Provide a bounded credential without whitespace or control characters.");result[field]=input;continue;}
  const value=input.trim();if(value===""){result[field]="";continue;}
  if(field.endsWith("public_key")){if(!isValidSendgridPublicKey(value))throw emailConnectionError("EMAIL_CONNECTION_INVALID_INPUT","Provide an EC P-256 public verification key.");result[field]=publicKey(value).export({type:"spki",format:"pem"}).trim();}
  else{if(!isValidEmailMailbox(value))throw emailConnectionError("EMAIL_CONNECTION_INVALID_INPUT","Provide a single valid sender and reply mailbox.");result[field]=value.toLowerCase();}
 }
 return result;
}
export function publicEmailSettings(config){
 const key=value=>isValidSendgridPublicKey(value)?publicKey(value).export({type:"spki",format:"pem"}).trim():"";
 return {provider:typeof config.provider==="string"?config.provider.slice(0,100):"sandbox",from_email:isValidEmailMailbox(config.from_email)?config.from_email:"",reply_to:isValidEmailMailbox(config.reply_to)?config.reply_to:"",api_key:typeof config.api_key==="string"&&config.api_key.length?EMAIL_SECRET_MASK:"",api_key_configured:typeof config.api_key==="string"&&config.api_key.length>0,sendgrid_events_public_key:key(config.sendgrid_events_public_key),sendgrid_inbound_public_key:key(config.sendgrid_inbound_public_key)};
}
export async function requireEmailConnectionOwner(tx,org,actor){if(!actor||actor.role!=="OWNER"||!await tx.get("SELECT id FROM users WHERE organization_id=? AND id=? AND role='OWNER'",[org,actor.id]))throw emailConnectionError("EMAIL_CONNECTION_OWNER_REQUIRED","A current workspace owner is required.",403);}
export function parseEmailConnectionJson(value,max=16384){try{if(typeof value!=="string"||Buffer.byteLength(value,"utf8")>max)throw new Error();return JSON.parse(value);}catch{throw emailConnectionError("EMAIL_CONNECTION_STATE_INVALID","Saved email setup requires operational inspection.",503);}}
export function emailChangeSummary(row){if(!row)return null;return {id:row.id,revision:row.revision,operation:row.operation,before:parseEmailConnectionJson(row.before_json),after:parseEmailConnectionJson(row.after_json),reason:row.reason,created_at:row.created_at,created_by:row.created_by};}
export function isValidEmailRouteToken(token){return typeof token==="string"&&/^[A-Za-z0-9_-]{1,200}$/.test(token);}
function canonical(value,depth=0){
 if(depth>32)throw emailConnectionError("EMAIL_CONNECTION_STATE_INVALID","Email configuration is too deeply nested for review.",503);
 if(value===null||typeof value==="boolean"||typeof value==="string"||(typeof value==="number"&&Number.isFinite(value)))return JSON.stringify(value);
 if(Array.isArray(value))return "["+value.map(item=>canonical(item,depth+1)).join(",")+"]";
 if(!value||typeof value!=="object"||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw emailConnectionError("EMAIL_CONNECTION_STATE_INVALID","Email configuration is invalid for review.",503);
 return "{"+Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>JSON.stringify(key)+":"+canonical(value[key],depth+1)).join(",")+"}";
}
