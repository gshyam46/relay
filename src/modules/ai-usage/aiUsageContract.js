import { createHash } from "node:crypto";
export const MAX_TOKENS = 2147483647;
export const AI_ERRORS = Object.freeze({ AI_PAUSED: [409,"AI requests are paused for this workspace."], AI_DAILY_LIMIT: [429,"The workspace AI daily request limit has been reached."], AI_IN_FLIGHT_LIMIT: [429,"The workspace AI request slots are currently occupied."], AI_ORIGIN_STALE: [409,"The analysis or reply request is no longer current."], AI_INVOCATION_REPLAYED: [409,"This AI invocation already has a recorded admission; no second request was authorized."], AI_ACCOUNTING_UNAVAILABLE: [503,"AI accounting could not be persisted; review the request history."], AI_CONTEXT_REQUIRED: [422,"A current scoped AI invocation context is required."], AI_REQUEST_INVALID: [422,"The AI request is outside the supported contract."], AI_STATE_INVALID: [503,"Saved AI controls or usage require operational review."], AI_USAGE_INVALID: [422,"The AI usage observation is invalid."], AI_CONTROLS_STALE: [409,"AI controls changed; reload before saving."], AI_OWNER_REQUIRED: [403,"Only a current workspace owner may change AI controls."], AI_OBSERVATION_CONFLICT: [409,"Different usage was already recorded for this invocation."] });
export function aiError(code) { const [statusCode,message] = AI_ERRORS[code] || AI_ERRORS.AI_STATE_INVALID; return Object.assign(new Error(message),{code,statusCode}); }
export function isAiAdmissionError(error) { return Boolean(error && Object.hasOwn(AI_ERRORS,error.code)); }
export const hash = value => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
export function identifier(value,max=128) { if(typeof value!=="string" || !value || value.length>max || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value) || value.includes("://")) throw aiError("AI_REQUEST_INVALID"); return value; }
export function boundInteger(value,min,max,code="AI_REQUEST_INVALID") { if(!Number.isSafeInteger(value)||value<min||value>max)throw aiError(code); return value; }
export function exact(value,keys,code="AI_REQUEST_INVALID") { if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).sort().join(",")!==[...keys].sort().join(","))throw aiError(code); }
export function rate(value) { if(typeof value!=="string"||!/^\d{1,7}(?:\.\d{1,6})?$/.test(value))throw aiError("AI_REQUEST_INVALID"); const [whole,fraction=""]=value.split("."); const micro=BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,"0")); if(micro>1000000000000n)throw aiError("AI_REQUEST_INVALID");return (micro/1000000n).toString()+"."+(micro%1000000n).toString().padStart(6,"0"); }
export function normalizeControls(input) {
 exact(input,["paused","max_daily_attempts","max_in_flight","pricing"]);
 if(typeof input.paused!=="boolean"||!Array.isArray(input.pricing)||input.pricing.length>20)throw aiError("AI_REQUEST_INVALID");
 const seen=new Set(), pricing=input.pricing.map(item=>{ exact(item,["provider","model","input_usd_per_million","output_usd_per_million"]);const provider=identifier(item.provider),model=identifier(item.model),key=provider+"\n"+model;if(seen.has(key))throw aiError("AI_REQUEST_INVALID");seen.add(key);return {provider,model,input_usd_per_million:rate(item.input_usd_per_million),output_usd_per_million:rate(item.output_usd_per_million)}; }).sort((a,b)=>(a.provider+"\n"+a.model).localeCompare(b.provider+"\n"+b.model));
 return {paused:input.paused,max_daily_attempts:boundInteger(input.max_daily_attempts,1,10000),max_in_flight:boundInteger(input.max_in_flight,1,100),pricing};
}
export const defaultControls=()=>({paused:false,max_daily_attempts:100,max_in_flight:2,pricing:[]});
export function parseControls(row) { if(!row)return {revision:0,...defaultControls(),updated_by:null,updated_at:null};try{boundInteger(row.revision,0,MAX_TOKENS);if(![0,1].includes(Number(row.paused)))throw Error();return {revision:row.revision,...normalizeControls({paused:Boolean(Number(row.paused)),max_daily_attempts:row.max_daily_attempts,max_in_flight:row.max_in_flight,pricing:JSON.parse(row.pricing_json)}),updated_by:row.updated_by,updated_at:row.updated_at};}catch{throw aiError("AI_STATE_INVALID");} }
export function usd(micro) { if(micro===null||micro===undefined)return null; const n=BigInt(micro);return (n/1000000n).toString()+"."+(n%1000000n).toString().padStart(6,"0"); }
export function estimateCost(pricing,usage) { if(!pricing||usage.usage_status!=="PROVIDER_REPORTED")return null; const parse=value=>BigInt(value.replace(".",""));const numerator=BigInt(usage.input_tokens)*parse(pricing.input_usd_per_million)+BigInt(usage.output_tokens)*parse(pricing.output_usd_per_million);return ((numerator+999999n)/1000000n).toString(); }
export function parseProviderUsage(value) {
 const unknown=reason=>({usage_status:"UNKNOWN",input_tokens:null,output_tokens:null,total_tokens:null,usage_reason:reason});
 if(value===null||value===undefined)return unknown("NOT_REPORTED");
 if(!value||typeof value!=="object"||Array.isArray(value))return unknown("INVALID_USAGE");
 const input=value.prompt_tokens,output=value.completion_tokens,total=value.total_tokens;
 if([input,output,total].some(n=>!Number.isSafeInteger(n)||n<0||n>MAX_TOKENS)||total!==input+output)return unknown("INVALID_OR_INCOMPLETE_USAGE");
 return {usage_status:"PROVIDER_REPORTED",input_tokens:input,output_tokens:output,total_tokens:total,usage_reason:null};
}
export function safeReference(value) { try {return value==null?null:identifier(value,256);}catch{return null;} }
export function normalizeObservation(value) {
 if(!value||typeof value!=="object"||!['COMPLETED','HTTP_REJECTED','INVALID_RESPONSE','TRANSPORT_UNCONFIRMED','TIMEOUT'].includes(value.outcome))throw aiError("AI_USAGE_INVALID");
 const usage=value.usage?.usage_status==="PROVIDER_REPORTED"?parseProviderUsage({prompt_tokens:value.usage.input_tokens,completion_tokens:value.usage.output_tokens,total_tokens:value.usage.total_tokens}):{usage_status:"UNKNOWN",input_tokens:null,output_tokens:null,total_tokens:null,usage_reason:["NOT_REPORTED","INVALID_USAGE","INVALID_OR_INCOMPLETE_USAGE"].includes(value.usage?.usage_reason)?value.usage.usage_reason:"NOT_REPORTED"};
 return {outcome:value.outcome,http_status:value.http_status==null?null:boundInteger(value.http_status,100,599,"AI_USAGE_INVALID"),response_model:safeReference(value.response_model),provider_response_id:safeReference(value.provider_response_id),...usage,elapsed_ms:value.elapsed_ms==null?null:boundInteger(value.elapsed_ms,0,MAX_TOKENS,"AI_USAGE_INVALID")};
}
