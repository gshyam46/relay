import { randomBytes } from "node:crypto";
import { createId } from "../../shared/ids.js";
import { ContactPolicyService } from "../contact-policy/contactPolicyService.js";
import { SettingsRepository } from "../settings/settingsRepository.js";
import { AuditRepository } from "../events/auditRepository.js";
import { EmailConnectionRepository,emailRouteOwners } from "./emailConnectionRepository.js";
import { EMAIL_SECRET_MASK,MAX_EMAIL_CHANGES,MAX_GENERATED_ROUTES,emailConnectionError,emailConnectionObject,emailConnectionText,emailConnectionInteger,emailConnectionHash,normalizeEmailConnectionValues,publicEmailSettings,assessEmailConfiguration,requireEmailConnectionOwner,emailChangeSummary,isValidEmailRouteToken } from "./emailConnectionContract.js";
const scopeKeys=["organization_id","actor"];
const verificationChecks=[["credential","Provider credential and permission"],["sender_domain","Sender and domain ownership"],["delivery_failure","Real delivery and failure callbacks"],["inbound","Inbound mailbox and signed Parse policy"],["suppression","Unsubscribe, complaint and suppression"]];
export class EmailConnectionService{
 constructor(db,{publicOrigin,now=Date.now}={}){
  this.db=db.rootDatabase||db;this.policy=new ContactPolicyService(this.db);this.now=now;
  const url=new URL(publicOrigin);if(!["http:","https:"].includes(url.protocol)||url.origin!==publicOrigin||url.username||url.password)throw new TypeError("Email setup requires the configured canonical public origin.");this.publicOrigin=publicOrigin;
 }
 async get(input){emailConnectionObject(input,scopeKeys);return this.gate(input,async(tx,org)=>{
  const view=(await this.state(tx,org)).view;
  const {assessCurrentChannelCapability}=await import("./channelCapability.js");
  const capability=await assessCurrentChannelCapability(tx,{organization_id:org,action_type:"SEND_EMAIL",strict:true,now:this.now});
  if(capability.verification==="VERIFIED")return {...view,live_send_available:true,verification:{status:"VERIFIED",checks:view.verification.checks.map(check=>({...check,status:"VERIFIED"}))},hold_reasons:view.hold_reasons.filter(code=>code!=="CHANNEL_VERIFICATION_REQUIRED")};
  return view;
 });}
 async history(input){
  emailConnectionObject(input,[...scopeKeys,"before_revision","limit"],scopeKeys);const before=input.before_revision==null?null:emailConnectionInteger(input.before_revision,null,1,100),limit=emailConnectionInteger(input.limit,20,1,50);
  return this.gate(input,async(tx,org)=>({history:await new EmailConnectionRepository(tx).history(org,before,limit)}));
 }
 async byRequestKey(input){emailConnectionObject(input,[...scopeKeys,"request_key"]);const key=emailConnectionText(input.request_key,"request key",200);return this.gate(input,async(tx,org)=>({change:emailChangeSummary(await new EmailConnectionRepository(tx).byRequest(org,key))}));}
 async resolveWebhookToken(token){const owners=await emailRouteOwners(this.db,token);return owners[0]||null;}
 save(input){return this.change(input,"SAVE");}
 provisionRoute(input){return this.change(input,"PROVISION_ROUTE");}
 rotateRoute(input){return this.change(input,"ROTATE_ROUTE");}
 async gate(input,work){
  const org=emailConnectionText(input.organization_id,"workspace");
  return this.policy.withWorkspacePolicyTransaction(org,async tx=>{await requireEmailConnectionOwner(tx,org,input.actor);return work(tx,org);});
 }
 snapshot(config,revision,management,routes){
  const generated=routes.filter(route=>route.route_kind==="GENERATED"),advertised=generated[0],configuration=assessEmailConfiguration(config);
  return {revision,management,settings:publicEmailSettings(config),configuration,verification:{status:"UNVERIFIED",checks:verificationChecks.map(([id,label])=>({id,label,status:"UNVERIFIED"}))},
   routing:{provisioned:Boolean(advertised),inbound_url:advertised?this.publicOrigin+"/api/webhooks/sendgrid/inbound/"+encodeURIComponent(advertised.token):null,events_url:advertised?this.publicOrigin+"/api/webhooks/sendgrid/events/"+encodeURIComponent(advertised.token):null,generated_alias_count:generated.length,legacy_route_present:routes.some(route=>route.route_kind==="LEGACY")||(!generated.length&&isValidEmailRouteToken(config.webhook_token))}};
 }
 async state(tx,org){
  const repository=new EmailConnectionRepository(tx),config=await repository.settings(org),head=await repository.latest(org),routes=await repository.routes(org),revision=head?.revision||0;
  if(Object.hasOwn(config,"connection_revision")?(!Number.isSafeInteger(config.connection_revision)||config.connection_revision!==revision):revision!==0)throw emailConnectionError("EMAIL_CONNECTION_STATE_INVALID","Reserved connection revision requires operational inspection.",503);
  const currentRoute=routes.find(route=>route.route_kind==="GENERATED");
  if(currentRoute&&config.webhook_token!==currentRoute.token)throw emailConnectionError("EMAIL_CONNECTION_STATE_INVALID","Reserved advertised routing requires operational inspection.",503);
  const hash=emailConnectionHash(config),management=!head?"LEGACY":head.config_fingerprint===hash?"MANAGED":"DRIFTED";
  const snapshot=this.snapshot(config,revision,management,routes),hold_reasons=[];
  if(management==="DRIFTED")hold_reasons.push("EMAIL_CONNECTION_CONFIG_DRIFT");
  const provider=config.provider||"sandbox";
  if(provider!=="sandbox")hold_reasons.push(provider!=="sendgrid"?"CHANNEL_LIVE_UNSUPPORTED":!snapshot.configuration.complete?"CHANNEL_SETUP_REQUIRED":"CHANNEL_VERIFICATION_REQUIRED");
  let routeProblem=null;
  if(config.webhook_token!==undefined&&config.webhook_token!==null&&config.webhook_token!==""){
   if(!isValidEmailRouteToken(config.webhook_token))routeProblem="CHANNEL_ROUTE_INVALID";
   else try{await emailRouteOwners(tx,config.webhook_token);}catch(error){if(error.code!=="CHANNEL_ROUTE_AMBIGUOUS")throw error;routeProblem=error.code;}
  }
  if(routeProblem)hold_reasons.push(routeProblem);
  if(revision>=MAX_EMAIL_CHANGES)hold_reasons.push("EMAIL_CONNECTION_REVISION_LIMIT");
  const can_save=revision<MAX_EMAIL_CHANGES;
  const review_token=can_save?emailConnectionHash({version:1,organization_id:org,revision,config_fingerprint:hash,routes:routes.map(({id,token,route_kind,created_revision})=>({id,token,route_kind,created_revision}))}):null;
  return {config,head,routes,snapshot,routeProblem,view:{...snapshot,review_token,live_send_available:false,can_save,can_provision:can_save&&!routeProblem&&snapshot.routing.generated_alias_count===0,can_rotate:can_save&&!routeProblem&&snapshot.routing.generated_alias_count>0&&snapshot.routing.generated_alias_count<MAX_GENERATED_ROUTES,hold_reasons,history:await repository.history(org)}};
 }
 async change(input,operation){
  emailConnectionObject(input,[...scopeKeys,"expected_revision","review_token","request_key","reason",...(operation==="SAVE"?["values"]:[])]);
  const expected=emailConnectionInteger(input.expected_revision,undefined,0,100);if(expected===undefined)throw emailConnectionError("EMAIL_CONNECTION_INVALID_INPUT","Provide the expected connection revision.");
  const requestKey=emailConnectionText(input.request_key,"request key",200),reason=emailConnectionText(input.reason,"change reason",2000);
  if(typeof input.review_token!=="string"||!/^[0-9a-f]{64}$/.test(input.review_token))throw emailConnectionError("EMAIL_CONNECTION_INVALID_INPUT","Provide the current email setup review token.");
  const values=operation==="SAVE"?normalizeEmailConnectionValues(input.values,{api_key:EMAIL_SECRET_MASK}):null;
  const requestHash=emailConnectionHash({version:1,operation,organization_id:input.organization_id,actor_id:input.actor?.id,expected_revision:expected,review_token:input.review_token,request_key:requestKey,reason,values});
  return this.gate(input,async(tx,org)=>{
   const repository=new EmailConnectionRepository(tx),prior=await repository.byRequest(org,requestKey);
   if(prior){if(prior.request_hash!==requestHash)throw emailConnectionError("EMAIL_CONNECTION_REQUEST_CONFLICT","This request key already records different email setup.",409);return {change:emailChangeSummary(prior),replayed:true};}
   const state=await this.state(tx,org),revision=state.snapshot.revision;
   if(revision!==expected)throw emailConnectionError("EMAIL_CONNECTION_REVISION_STALE","Email setup has a newer recorded revision.",409);
   if(revision>=MAX_EMAIL_CHANGES)throw emailConnectionError("EMAIL_CONNECTION_REVISION_LIMIT","Email setup reached its bounded history limit.",409);
   if(state.view.review_token!==input.review_token)throw emailConnectionError("EMAIL_CONNECTION_REVIEW_STALE","Saved email configuration or routing changed. Review the current setup.",409);
   const generated=state.routes.filter(route=>route.route_kind==="GENERATED");
   if(operation!=="SAVE"){
    if(state.routeProblem)throw emailConnectionError(state.routeProblem,"Existing routing ownership requires inspection before changing the advertised route.",409);
    if(operation==="PROVISION_ROUTE"&&generated.length)throw emailConnectionError("EMAIL_CONNECTION_ROUTE_EXISTS","A managed route already exists; use explicit rotation.",409);
    if(operation==="ROTATE_ROUTE"&&!generated.length)throw emailConnectionError("EMAIL_CONNECTION_ROUTE_REQUIRED","Provision the first managed webhook route before rotation.",409);
    if(generated.length>=MAX_GENERATED_ROUTES)throw emailConnectionError("EMAIL_CONNECTION_ROUTE_LIMIT","This workspace reached its generated routing-alias limit.",409);
   }
   const nextRevision=revision+1,at=new Date(this.now()).toISOString(),next={...state.config},newRoutes=[];
   if(operation==="SAVE"){
    Object.assign(next,normalizeEmailConnectionValues(input.values,state.config));
   }else{
    if(!generated.length&&isValidEmailRouteToken(state.config.webhook_token)&&!state.routes.some(route=>route.token===state.config.webhook_token)){
     const owners=await emailRouteOwners(tx,state.config.webhook_token);if(owners.length!==1||owners[0]!==org)throw emailConnectionError("CHANNEL_ROUTE_AMBIGUOUS","Existing routing ownership requires inspection.",409);
     newRoutes.push({id:createId("email_route"),organization_id:org,token:state.config.webhook_token,route_kind:"LEGACY",created_revision:nextRevision,created_at:at,created_by:input.actor.id});
    }
    let token=null;for(let attempt=0;attempt<8;attempt++){const candidate="whk_"+randomBytes(24).toString("base64url");if(!(await emailRouteOwners(tx,candidate)).length){token=candidate;break;}}
    if(!token)throw emailConnectionError("EMAIL_CONNECTION_STATE_INVALID","A unique routing alias could not be reserved.",503);
    next.webhook_token=token;newRoutes.unshift({id:createId("email_route"),organization_id:org,token,route_kind:"GENERATED",created_revision:nextRevision,created_at:at,created_by:input.actor.id});
   }
   next.connection_revision=nextRevision;
   const after=this.snapshot(next,nextRevision,"MANAGED",[...newRoutes,...state.routes]);
   const beforeJson=JSON.stringify(state.snapshot),afterJson=JSON.stringify(after);
   if(Buffer.byteLength(beforeJson)>16384||Buffer.byteLength(afterJson)>16384)throw emailConnectionError("EMAIL_CONNECTION_SETTINGS_LIMIT","Public email setup history exceeds its bounded size.",413);
   const updates={connection_revision:nextRevision,...(operation==="SAVE"?Object.fromEntries(Object.keys(values).map(key=>[key,next[key]])):{}),...(next.webhook_token!==undefined?{webhook_token:next.webhook_token}:{})};
   await repository.assertProposedSettings(org,updates);
   const change={id:createId("email_connection"),organization_id:org,revision:nextRevision,expected_revision:revision,operation,config_fingerprint:emailConnectionHash(next),before_json:beforeJson,after_json:afterJson,request_key:requestKey,request_hash:requestHash,reason,created_at:at,created_by:input.actor.id};
   await repository.appendChange(change);
   for(const route of newRoutes)await repository.appendRoute(route);
   await new SettingsRepository(tx).setBulk(org,"channel_email",updates);
   await new AuditRepository(tx).record({organization_id:org,event_type:"EmailConnectionChanged",message:"Owner updated email setup with an exact recorded revision.",metadata:{change_id:change.id,revision:nextRevision,operation,actor:input.actor.id}});
   return {change:emailChangeSummary(change),replayed:false};
  });
 }
}
