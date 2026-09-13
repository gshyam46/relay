import { AsyncLocalStorage } from "node:async_hooks";
import { aiError, identifier, boundInteger } from "./aiUsageContract.js";
const invocations=new AsyncLocalStorage();
export function withAiInvocationContext(context,work) {
 if(!context||!['SYNTHESIS','REPLY_CLASSIFICATION'].includes(context.purpose)||!['DOMAIN_EVENT','INBOUND_RECEIPT'].includes(context.origin?.kind)||typeof work!=="function")throw aiError("AI_CONTEXT_REQUIRED");
 const value=Object.freeze({organization_id:identifier(context.organization_id,256),lead_id:context.lead_id?identifier(context.lead_id,256):null,purpose:context.purpose,origin:Object.freeze({kind:context.origin.kind,id:identifier(context.origin.id,256),fence:boundInteger(context.origin.fence,1,2147483647)}),input_fingerprint:typeof context.input_fingerprint==="string"&&/^[0-9a-f]{64}$/.test(context.input_fingerprint)?context.input_fingerprint:null});
 if(value.purpose==="SYNTHESIS"&&(!value.lead_id||value.origin.kind!=="DOMAIN_EVENT"))throw aiError("AI_CONTEXT_REQUIRED");
 if(value.purpose==="REPLY_CLASSIFICATION"&&value.origin.kind!=="INBOUND_RECEIPT")throw aiError("AI_CONTEXT_REQUIRED");
 return invocations.run(value,work);
}
export function currentAiInvocationContext(){return invocations.getStore()||null;}
