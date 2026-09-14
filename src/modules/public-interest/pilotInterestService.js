import {createHash,createHmac} from "node:crypto";
import {createId} from "../../shared/ids.js";
import {normalizePeerAddress} from "../../shared/httpRequestPolicy.js";
const HOUR=3600000,DAY=24*HOUR,globalKey="0".repeat(64);
const problem=(statusCode,code,message)=>Object.assign(new Error(message),{statusCode,code});
export function normalizePilotRequest(input){
 const purpose=input?.purpose;
 if(purpose!==undefined&&!["AVAILABILITY_SIGNUP","AVAILABILITY_SIGNIN","AVAILABILITY_ONBOARDING"].includes(purpose))throw problem(400,"PILOT_REQUEST_INVALID","Choose a valid interest purpose.");
 const fields=["request_key","name","email","company","workflow","channel","consent","website"];
 if(!input||typeof input!=="object"||Array.isArray(input)||Object.keys(input).length!==fields.length+(purpose===undefined?0:1)||fields.some(key=>!Object.hasOwn(input,key)))throw problem(400,"PILOT_REQUEST_INVALID","Complete the pilot request fields.");
 const value={};for(const [key,limit] of Object.entries({request_key:200,name:200,email:254,company:200,workflow:2000,website:200})){
  if(typeof input[key]!=="string")throw problem(400,"PILOT_REQUEST_INVALID","Request fields must be text.");
  value[key]=input[key].replace(/\r\n/g,"\n").trim();
  if(value[key].length>limit||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value[key])||key!=="website"&&!value[key])throw problem(400,"PILOT_REQUEST_INVALID","Check the required fields and their lengths.");
 }
 if(!/^[a-zA-Z0-9_-]{16,200}$/.test(value.request_key)||!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value.email)||value.email.split("@")[0].length>64||input.consent!==true||!["EMAIL","WHATSAPP","UNDECIDED"].includes(input.channel))throw problem(400,"PILOT_REQUEST_INVALID","Provide a valid email, channel and consent.");
 value.email=value.email.toLowerCase();value.channel=input.channel;value.consent=true;if(purpose!==undefined){value.purpose=purpose;value.workflow="Availability update requested from "+purpose.slice(13).toLowerCase()+".";}return value;
}
export class PilotInterestService{
 constructor(db,{secret,now=Date.now}={}){if(typeof secret!=="string"||secret.length<32)throw new TypeError("Pilot admission requires the configured server secret.");this.db=db;this.secret=secret;this.now=now;}
 async submit(input,peerAddress){
  const value=normalizePilotRequest(input);if(value.website){if(value.purpose)throw problem(400,"PILOT_REQUEST_INVALID","The request could not be saved.");return {accepted:true};}
  const {request_key,website,...fields}=value;
  const fingerprint=createHash("sha256").update(JSON.stringify(fields)).digest("hex");
  const peer=createHmac("sha256",this.secret).update(normalizePeerAddress(peerAddress)).digest("hex");
  try{return await this.db.transaction(async tx=>{
   const gate=await tx.get("SELECT * FROM pilot_request_limits WHERE identity_hash=?"+(tx.kind==="postgres"?" FOR UPDATE":""),[globalKey]);
   if(!gate)throw problem(503,"PILOT_REQUEST_UNAVAILABLE","Requests are temporarily unavailable.");
   const prior=await tx.get("SELECT request_hash FROM pilot_interest_requests WHERE request_key=?",[request_key]);
   if(prior){if(prior.request_hash!==fingerprint)throw problem(409,"PILOT_REQUEST_CONFLICT","This request reference already records different details.");return {accepted:true};}
   const now=this.now();if(!Number.isSafeInteger(now)||now<0)throw new Error("Invalid admission clock");
   const peerRow=await tx.get("SELECT * FROM pilot_request_limits WHERE identity_hash=?",[peer]);
   for(const [row,window,limit]of[[gate,DAY,500],[peerRow,HOUR,5]])if(row){if(!Number.isSafeInteger(row.attempts)||row.attempts<0||!Number.isSafeInteger(row.window_started_at)||row.window_started_at>now)throw new Error("Invalid request admission state");if(now-row.window_started_at<window&&row.attempts>=limit)throw Object.assign(problem(429,"PILOT_REQUEST_RATE_LIMITED","Too many requests. Try again later."),{retryAfterSeconds:Math.ceil((row.window_started_at+window-now)/1000)});}
   await tx.run("DELETE FROM pilot_request_limits WHERE identity_hash IN(SELECT identity_hash FROM pilot_request_limits WHERE identity_hash<>? AND window_started_at<? ORDER BY window_started_at LIMIT 50)",[globalKey,now-HOUR]);
   if(!peerRow&&Number((await tx.get("SELECT count(*) n FROM pilot_request_limits")).n)>=2000)throw problem(503,"PILOT_REQUEST_UNAVAILABLE","Requests are temporarily unavailable.");
   if(Number((await tx.get("SELECT count(*) n FROM pilot_interest_requests")).n)>=10000)throw problem(503,"PILOT_REQUEST_UNAVAILABLE","Requests are temporarily unavailable.");
   for(const [key,row,window]of[[globalKey,gate,DAY],[peer,peerRow,HOUR]]){
    const reset=!row||now-row.window_started_at>=window;
    await tx.run("INSERT INTO pilot_request_limits(identity_hash,window_started_at,attempts) VALUES(?,?,?) ON CONFLICT(identity_hash) DO UPDATE SET window_started_at=excluded.window_started_at,attempts=excluded.attempts",[key,reset?now:row.window_started_at,reset?1:row.attempts+1]);
   }
   const at=new Date(now).toISOString();await tx.run("INSERT INTO pilot_interest_requests(id,request_key,request_hash,name,email,company,workflow,channel,consent_version,status,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,'NEW',?,?)",[createId("pilot"),request_key,fingerprint,fields.name,fields.email,fields.company,fields.workflow,fields.channel,fields.purpose?fields.purpose.toLowerCase()+"-v1":"pilot-interest-v1",at,new Date(now+90*DAY).toISOString()]);
   return {accepted:true};
  },{lockTimeoutMs:5000});}catch(error){if(error.code?.startsWith("PILOT_REQUEST_"))throw error;throw problem(503,"PILOT_REQUEST_UNAVAILABLE","Your request could not be confirmed. Retry the same request reference.");}
 }
}
