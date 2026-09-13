import {useRef,useState} from "react";
import {useQuery,useQueryClient} from "@tanstack/react-query";
import {api,ApiError} from "@/lib/api";
import {ApprovalReviewDialog} from "./approval-review-dialog";
const button="rounded-lg border border-line px-3 py-2 text-sm disabled:opacity-50";
type Probe={id:string;purpose:string;lead_id:string;action_id:string;revision_id:string;current_revision_id:string;status:string};
type Verification={id:string;connection_revision:number;status:string;current:boolean;live_send_available:boolean;check:null|{id:string;number:number;state:string;expires_at:string|null;checks:{id:string;status:string;code:string}[]};probes:Probe[];milestones:{kind:string;status:string;recorded_at:string|null}[];can_check:boolean;can_probe:{DELIVERY:boolean;FAILURE:boolean};instructions:{reply:string;stop:string;recipient:string;reply_to:string}};
type View={connection_revision:number;review_token:string;controlled_recipients:{delivery:string|null;failure:string|null};can_create:boolean;verification:Verification|null;live_send_available:boolean;hold_reasons:string[]};
type Pending={path:string;body:Record<string,unknown>;rejected:boolean};
function label(value:string){return value.toLowerCase().replaceAll("_"," ");}
export function EmailVerification(){
 const qc=useQueryClient(),query=useQuery({queryKey:["email-verification"],queryFn:()=>api.get<View>("/channels/email/verification")});
 const [reason,setReason]=useState(""),[pending,setPending]=useState<Pending|null>(null),ref=useRef<Pending|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState(""),[review,setReview]=useState<string|null>(null);
 function keep(value:Pending|null){ref.current=value;setPending(value);}
 function refresh(){void query.refetch();void qc.invalidateQueries({queryKey:["email-connection"]});}
 async function send(command:Pending){
  if(busy)return;setBusy(true);
  try{await api.post(command.path,command.body);if(ref.current===command){keep(null);setNotice("The server accepted this request. Its recorded status is shown below.");refresh();}}
  catch(error){if(ref.current===command){if(error instanceof ApiError&&error.status>=400&&error.status<500&&error.status!==408&&error.status!==429){command={...command,rejected:true};keep(command);}setNotice(error instanceof ApiError&&typeof error.body==="object"&&error.body?(error.body as {error?:string}).error||"The request was rejected.":"The response was lost or unavailable. Retry the same request to recover its accepted result; it will not create another probe.");}}
  finally{setBusy(false);}
 }
 function submit(path:string,body:Record<string,unknown>){if(ref.current||busy)return;const command={path,body:{...body,request_key:crypto.randomUUID()},rejected:false};keep(command);setNotice("");void send(command);}
 const value=query.data,run=value?.verification,locked=!!pending||busy;
 return <section className="rounded-xl border border-line bg-surface p-5 space-y-4" aria-labelledby="email-verification-title">
  <h2 id="email-verification-title" className="text-lg font-semibold">Verify the email journey</h2>
  <p className="text-sm text-muted">Configuration checks and controlled test messages establish separate evidence. Normal live sends remain held until delivery, rejection, reply and stop are verified for the current configuration. A changed configuration needs current evidence.</p>
  <button className={button} disabled={query.isFetching} onClick={refresh}>Refresh verification evidence</button>
  {notice&&<p role="status" className="text-sm rounded-lg bg-soft p-3">{notice}</p>}
  {pending&&<div className="border border-line rounded-lg p-3 space-y-2"><p className="text-xs break-all">Request: {String(pending.body.request_key)}</p>{pending.rejected?<button className={button} disabled={busy} onClick={()=>{keep(null);refresh();setNotice("Review refreshed evidence before a new request.");}}>Refresh after rejected verification</button>:<button className={button} disabled={busy} onClick={()=>void send(pending)}>Retry same verification request</button>}</div>}
  {query.isPending?<p>Loading verification...</p>:query.isError?<p role="alert">Verification evidence is unavailable. Refresh to retry; sending remains governed by the server.</p>:value&&<>
   <p className="text-sm"><strong>{value.live_send_available?"Current channel evidence recorded":"Normal live sends held"}</strong>{run?" / "+label(run.status):" / no verification run"}</p>
   <ul className="list-disc pl-5 text-sm">{value.hold_reasons.map((reason,index)=><li key={index}>{label(reason)}</li>)}</ul>
   <dl className="grid gap-x-3 gap-y-1 sm:grid-cols-[auto_1fr] text-sm"><dt>Authorized delivery mailbox</dt><dd className="break-all">{value.controlled_recipients.delivery||"Deployment operator has not configured one."}</dd><dt>Authorized rejection sink</dt><dd className="break-all">{value.controlled_recipients.failure||"Deployment operator has not configured one."}</dd></dl>
   <p className="text-xs text-muted">The deployment operator must confirm control and authorization for both distinct destinations. These test destinations cannot be changed in this form. A mailbox that opts out retains its contact restriction.</p>
   {!run&&<form onSubmit={event=>{event.preventDefault();submit("/channels/email/verification",{expected_connection_revision:value.connection_revision,review_token:value.review_token,reason});}}><fieldset disabled={locked||!value.can_create} className="space-y-3"><label className="block text-sm">Reason for verification<textarea required maxLength={2000} value={reason} onChange={event=>setReason(event.target.value)} className="mt-1 w-full rounded-lg border border-line bg-surface p-2"/></label><button className={button}>Create verification record</button></fieldset></form>}
   {run&&<>
    <button className={button} disabled={locked||!run.can_check} onClick={()=>submit("/channels/email/verification/"+run.id+"/check",{})}>Check current provider configuration</button>
    <p className="text-xs text-muted">This explicit check reads bounded SendGrid configuration. It does not change provider settings or send a message. A successful check expires after 24 hours.</p>
    {run.check&&<div className="space-y-1 text-sm"><p>Configuration check {run.check.number}: {label(run.check.state)}{run.check.expires_at?" / expires "+new Date(run.check.expires_at).toLocaleString():""}</p>{run.check.checks.map(check=><p key={check.id}>{label(check.id)}: <strong>{label(check.status)}</strong> / {label(check.code)}</p>)}</div>}
    <div className="grid gap-3 sm:grid-cols-2">{(["DELIVERY","FAILURE"]as const).map(purpose=>{const probe=run.probes.find(item=>item.purpose===purpose);return <article key={purpose} className="rounded-lg border border-line p-3 space-y-2"><h3 className="font-medium">{purpose==="DELIVERY"?"Delivery and reply test":"Controlled rejection test"}</h3>{probe?<><p className="text-sm">Existing probe: {label(probe.status)}</p><button className={button} onClick={()=>setReview(probe.action_id)}>Review {purpose==="DELIVERY"?"delivery":"rejection"} probe</button><p className="text-xs">Review the exact fixed message and approve through the normal action controls. Recover this action if dispatch is uncertain; creating a replacement is not permitted.</p></>:<button className={button} disabled={locked||!run.can_probe[purpose]} onClick={()=>submit("/channels/email/verification/"+run.id+"/probes",{purpose})}>Prepare {purpose==="DELIVERY"?"delivery":"rejection"} probe for review</button>}</article>;})}</div>
    <div className="space-y-2"><h3 className="font-medium">Recorded journey evidence</h3>{run.milestones.map(item=><p key={item.kind} className="text-sm">{label(item.kind)}: <strong>{label(item.status)}</strong>{item.recorded_at?" / "+new Date(item.recorded_at).toLocaleString():""}</p>)}</div>
    {run.instructions&&<details><summary className="cursor-pointer text-sm">Instructions for the authorized delivery mailbox owner</summary><div className="mt-3 space-y-2 text-sm"><p>After receiving the approved delivery test, reply from {run.instructions.recipient} to {run.instructions.reply_to}. Send the reply text first and wait for recorded reply evidence, then send the stop text.</p><p>Reply text</p><pre className="whitespace-pre-wrap break-words rounded-lg bg-soft p-3">{run.instructions.reply}</pre><p>Stop text</p><pre className="whitespace-pre-wrap break-words rounded-lg bg-soft p-3">{run.instructions.stop}</pre><p>The stop request permanently restricts this contact through normal policy. It does not mark a real customer outcome.</p></div></details>}
   </>}
  </>}
  {review&&<ApprovalReviewDialog actionIds={[review]} onClose={()=>{setReview(null);refresh();}}/>}
 </section>;
}
