import {useRef,useState,type FormEvent} from "react";
import {useQuery,useQueryClient} from "@tanstack/react-query";
import {api,ApiError} from "@/lib/api";
import {useMe} from "@/hooks/use-auth";
const field="mt-1 w-full rounded-lg border border-line bg-surface p-2 text-sm";
const button="rounded-lg border border-line px-3 py-2 text-sm disabled:opacity-50";
type Change={id:string;revision?:number;operation?:string;status?:string;reason?:string;created_at?:string};
type Conversation={conversation:{revision:number;status:string;effective_status:string;read_state:string;assigned_owner_id:string|null;last_inbound_message_id:string|null;inbound_count:number;attention:string;review_token:string};history:{changes:Change[];has_more:boolean}};
type FollowUp={id:string;status:string;due_at:string;reason:string;state_token:string;origin:string;can_reschedule:boolean};
type FollowUps={follow_ups:FollowUp[];review_token:string;has_more:boolean;next_after_id:string|null};
type Amount={currency:string;scale:number;minor_units:string};
type Values={kind:string;occurred_at:string;summary:string;source_reference:string|null;evidence_message_id:string|null;attributed_action_id:string|null;attribution_note:string|null;amount:Amount|null};
type Outcome={id:string;slot:string;revision:number;status:string;values:Values;created_at:string;created_by:string};
type Outcomes={outcomes:Outcome[];review_token:string;has_more:boolean};
type Command={path:string;kind:string;key:string;body:Record<string,unknown>;rejected:boolean};
function human(value:string){return value.toLowerCase().replaceAll("_"," ");}
function failure(error:unknown){
 if(error instanceof ApiError && typeof error.body==="object" && error.body)return (error.body as {error?:string}).error||"The command was not accepted.";
 return "The result is unknown. Check the saved request before retrying.";
}
function localTime(value:string){const date=new Date(value);return Number.isFinite(date.getTime())?new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16):"";}
function instant(value:FormDataEntryValue|null){if(typeof value!=="string"||!value)return null;const date=new Date(value);return Number.isFinite(date.getTime())?date.toISOString():null;}
function amountText(amount:Amount|null){if(!amount)return "";const digits=amount.minor_units.padStart(amount.scale+1,"0");return amount.scale?digits.slice(0,-amount.scale)+"."+digits.slice(-amount.scale):digits;}
function useWorkflowCommand(onSaved:()=>void){
 const [pending,setPending]=useState<Command|null>(null),ref=useRef<Command|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState("");
 function keep(command:Command|null){ref.current=command;setPending(command);}
 function accepted(command:Command,change:Change|null){
  if(ref.current!==command)return;
  if(change){keep(null);setNotice("Saved. The original recorded result is confirmed.");onSaved();}
  else setNotice("No accepted command was found. Retry the same request; keep its original contents.");
 }
 async function send(command:Command){
  if(busy)return;setBusy(true);
  try{const result=await api.post<{change:Change}>(command.path,command.body);accepted(command,result.change);}
  catch(error){if(ref.current===command){if(error instanceof ApiError&&error.status>=400&&error.status<500&&error.status!==408&&error.status!==429){command={...command,rejected:true};keep(command);}setNotice(failure(error));}}
  finally{setBusy(false);}
 }
 function submit(path:string,kind:string,body:Record<string,unknown>){
  if(ref.current||busy)return;const key=crypto.randomUUID(),command={path,kind,key,body:{...body,request_key:key},rejected:false};keep(command);setNotice("");void send(command);
 }
 async function recover(){
  const command=ref.current;if(!command||busy)return;setBusy(true);
  try{const result=await api.get<{change:Change|null}>("/customer-workflow/requests/"+command.kind+"/"+encodeURIComponent(command.key));accepted(command,result.change);}
  catch(error){if(ref.current===command)setNotice(failure(error));}finally{setBusy(false);}
 }
 return {pending,busy,submit,panel:<div aria-live="polite" className="space-y-2">
  {notice&&<p role="status" className="rounded-lg border border-line bg-soft p-3 text-sm">{notice}</p>}
  {pending&&<div className="rounded-lg border border-line p-3 space-y-2"><p className="text-sm">This command keeps its original request identity while its result is checked. Keep this page open.</p><p className="text-xs break-all">Request: {pending.key}</p><div className="flex flex-wrap gap-2">
   <button className={button} disabled={busy} onClick={()=>void recover()}>Check saved request</button>
   {!pending.rejected&&<button className={button} disabled={busy} onClick={()=>void send(pending)}>Retry same request</button>}
   {pending.rejected&&<button className={button} disabled={busy} onClick={()=>{keep(null);onSaved();setNotice("Review the refreshed state before a new command.");}}>Refresh after rejected command</button>}
  </div></div>}
 </div>};
}
export function CustomerWorkflow({leadId,archived=false,conversationOnly=false}:{leadId:string;archived?:boolean;conversationOnly?:boolean}){
 const qc=useQueryClient(),me=useMe();
 const [after,setAfter]=useState<string|null>(null),[editing,setEditing]=useState<Outcome|null|undefined>(undefined),[historyId,setHistoryId]=useState<string|null>(null),[exporting,setExporting]=useState(false),[exportError,setExportError]=useState("");
 const base="/leads/"+encodeURIComponent(leadId);
 const conversation=useQuery({queryKey:["customer-workflow",leadId,"conversation"],queryFn:()=>api.get<Conversation>(base+"/conversation")});
 const followUps=useQuery({queryKey:["customer-workflow",leadId,"follow-ups",after],queryFn:()=>api.get<FollowUps>(base+"/follow-ups"+(after?"?after_id="+encodeURIComponent(after):"")),enabled:!conversationOnly});
 const outcomes=useQuery({queryKey:["customer-workflow",leadId,"outcomes"],queryFn:()=>api.get<Outcomes>(base+"/outcomes"),enabled:!conversationOnly});
 const history=useQuery({queryKey:["customer-workflow",leadId,"outcome-history",historyId],queryFn:()=>api.get<{outcome:Outcome;history:{changes:Outcome[];has_more:boolean}}>("/outcomes/"+encodeURIComponent(historyId!)+"?lead_id="+encodeURIComponent(leadId)),enabled:!!historyId});
 const command=useWorkflowCommand(()=>{
  setEditing(undefined);
  for(const key of ["customer-workflow","follow-ups","lead-timeline","dashboard"])void qc.invalidateQueries({queryKey:[key]});
 });
 const locked=!!command.pending||command.busy,c=conversation.data?.conversation;
 function saveConversation(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(!c)return;const data=new FormData(event.currentTarget);
  command.submit(base+"/conversation","CONVERSATION",{expected_revision:c.revision,review_token:c.review_token,status:data.get("status"),read_state:data.get("read_state"),assigned_owner_id:data.get("assigned")?me.data?.user.id:null,reason:data.get("reason")});
 }
 function createFollowUp(event:FormEvent<HTMLFormElement>){
  event.preventDefault();const data=new FormData(event.currentTarget);
  command.submit(base+"/follow-ups","FOLLOW_UP",{review_token:followUps.data?.review_token,due_at:instant(data.get("due_at")),reason:data.get("reason"),reply_to_message_id:null});
 }
 function changeFollowUp(event:FormEvent<HTMLFormElement>,task:FollowUp){
  event.preventDefault();const data=new FormData(event.currentTarget),operation=data.get("operation");
  command.submit("/follow-ups/"+encodeURIComponent(task.id)+"/change","FOLLOW_UP",{expected_task_token:task.state_token,operation,due_at:operation==="RESCHEDULE"?instant(data.get("due_at")):null,reason:data.get("reason")});
 }
 function saveOutcome(event:FormEvent<HTMLFormElement>){
  event.preventDefault();const data=new FormData(event.currentTarget),amount=String(data.get("amount")||"");
  command.submit(base+"/outcomes","OUTCOME",{outcome_id:editing?.id??null,expected_revision:editing?.revision??0,review_token:outcomes.data?.review_token,status:data.get("status"),reason:data.get("reason"),values:{kind:data.get("kind"),occurred_at:instant(data.get("occurred_at")),summary:data.get("summary"),source_reference:data.get("source_reference")||null,evidence_message_id:data.get("evidence_message_id")||null,attributed_action_id:data.get("attributed_action_id")||null,attribution_note:data.get("attribution_note")||null,amount:amount?{currency:data.get("currency"),value:amount}:null}});
 }
 async function exportRecords(){
  if(!outcomes.data?.outcomes.length||exporting)return;setExporting(true);setExportError("");
  try{
   const result=await fetch("/api/outcomes/export",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({outcome_ids:outcomes.data.outcomes.map(item=>item.id)})});
   if(!result.ok)throw new Error("The selected outcomes could not be exported. Refresh and retry.");
   const blob=await result.blob();if(!result.headers.get("Content-Type")?.startsWith("text/csv")||!blob.size||blob.size>8*1024*1024)throw new Error("No valid export was received.");
   const url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download="enquiry-outcomes.csv";document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(error){setExportError(error instanceof Error?error.message:"Export failed.");}finally{setExporting(false);}
 }
 return <div className="space-y-6" data-testid="customer-workflow">{command.panel}
  <section className="rounded-xl border border-line bg-surface p-5 space-y-3">
   <h2 className="text-lg font-semibold">Conversation ownership and attention</h2>
   <p className="text-sm text-muted">Reading, resolving and replying are separate decisions. A new inbound message reopens a resolved conversation.</p>
   {conversation.isPending?<p>Loading conversation state...</p>:conversation.isError?<p role="alert">Conversation state could not be loaded. <button className={button} onClick={()=>void conversation.refetch()}>Retry conversation</button></p>:c&&<>
    <p className="text-sm">Attention: <strong>{human(c.attention)}</strong> / {human(c.read_state)} / {c.inbound_count} inbound messages / revision {c.revision}</p>
    <form key={c.revision+":"+c.review_token} onSubmit={saveConversation}><fieldset disabled={locked} className="grid gap-3 sm:grid-cols-2">
     <label className="text-sm">Conversation status<select aria-label="Conversation status" name="status" defaultValue={c.effective_status} className={field}><option value="OPEN">Open</option><option value="RESOLVED">Resolved</option><option value="ESCALATED">Escalated for owner review</option></select></label>
     <label className="text-sm">Read state<select aria-label="Read state" name="read_state" defaultValue="KEEP" className={field}><option value="KEEP">Keep current read state</option><option value="READ">Mark current messages read</option><option value="UNREAD">Mark unread</option></select></label>
     <label className="text-sm flex items-center gap-2"><input type="checkbox" name="assigned" defaultChecked={c.assigned_owner_id===me.data?.user.id}/>Assign to me</label>
     <label className="text-sm sm:col-span-2">Reason for conversation change<textarea name="reason" required maxLength={2000} className={field}/></label>
     <button className={button+" justify-self-start"}>Save conversation state</button>
    </fieldset></form>
    <details><summary className="cursor-pointer text-sm">Conversation decision history</summary><div className="space-y-2 mt-2">
     {conversation.data?.history.changes.length?conversation.data.history.changes.map(item=><p key={item.id} className="text-sm">Revision {item.revision} / {item.status&&human(item.status)} / {item.created_at} / {item.reason}</p>):<p className="text-sm">No owner decisions recorded.</p>}
     {conversation.data?.history.has_more&&<p className="text-sm">Showing the latest 20 decisions.</p>}
    </div></details>
   </>}
  </section>
  {!conversationOnly&&<>
   <section className="rounded-xl border border-line bg-surface p-5 space-y-4">
    <h2 className="text-lg font-semibold">Follow-ups</h2>
    <p className="text-sm text-muted">These reminders create internal work. A message still needs its own reviewed draft and approval. Due times below use your device timezone.</p>
    {followUps.isError?<p role="alert">Follow-ups could not be loaded. <button className={button} onClick={()=>void followUps.refetch()}>Retry follow-ups</button></p>:followUps.isPending?<p>Loading follow-ups...</p>:<>
     <form onSubmit={createFollowUp}><fieldset disabled={locked||archived} className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm">Reminder due time<input name="due_at" type="datetime-local" required className={field}/></label>
      <label className="text-sm">Reminder and reason<input name="reason" required maxLength={2000} className={field}/></label>
      <button className={button+" justify-self-start"}>Create reminder</button>
     </fieldset></form>
     {followUps.data.follow_ups.length?followUps.data.follow_ups.map(task=><article key={task.id+task.state_token} className="border-t border-line pt-3 space-y-2">
      <p className="text-sm"><strong>{task.reason}</strong></p><p className="text-xs text-muted">{human(task.status)} / {new Date(task.due_at).toLocaleString()} / {human(task.origin)}</p>
      {!["COMPLETED","CANCELLED"].includes(task.status)&&<details><summary className="cursor-pointer text-sm">Update reminder</summary><form onSubmit={event=>changeFollowUp(event,task)}><fieldset disabled={locked} className="grid gap-3 mt-2 sm:grid-cols-2">
       <label className="text-sm">Reminder operation<select aria-label="Reminder operation" name="operation" className={field}><option value="COMPLETE">Complete internal work</option><option value="CANCEL">Cancel reminder</option>{task.can_reschedule&&<option value="RESCHEDULE">Reschedule reminder</option>}</select></label>
       {task.can_reschedule&&<label className="text-sm">New due time (for rescheduling)<input name="due_at" type="datetime-local" defaultValue={localTime(task.due_at)} className={field}/></label>}
       <label className="text-sm">Reason for reminder change<textarea name="reason" required maxLength={2000} className={field}/></label><button className={button+" self-end"}>Save reminder change</button>
      </fieldset></form></details>}
     </article>):<p className="text-sm">No reminders on this page.</p>}
     <div className="flex gap-2">{after&&<button className={button} onClick={()=>setAfter(null)}>First reminders</button>}{followUps.data.has_more&&<button className={button} onClick={()=>setAfter(followUps.data.next_after_id)}>Next reminders</button>}</div>
    </>}
   </section>
   <section className="rounded-xl border border-line bg-surface p-5 space-y-4">
    <div className="flex flex-wrap items-center gap-3"><h2 className="text-lg font-semibold mr-auto">Customer outcomes</h2><button className={button} disabled={locked||outcomes.isPending||outcomes.isError||archived} onClick={()=>setEditing(null)}>Record outcome</button><button className={button} disabled={exporting||!outcomes.data?.outcomes.length} onClick={()=>void exportRecords()}>Export these outcomes</button></div>
    <p className="text-sm text-muted">Owner-reported milestones, with one current record per milestone and one won/lost result for this enquiry. Deal value is reported value; it is not received revenue.</p>
    {exportError&&<p role="alert">{exportError}</p>}
    {outcomes.isError?<p role="alert">Outcomes could not be loaded. <button className={button} onClick={()=>void outcomes.refetch()}>Retry outcomes</button></p>:outcomes.isPending?<p>Loading outcomes...</p>:outcomes.data.outcomes.length?outcomes.data.outcomes.map(item=><article key={item.id} className="border-t border-line pt-3 space-y-2">
     <p className="text-sm"><strong>{human(item.values.kind)}</strong> / {human(item.status)} / revision {item.revision}</p><p className="text-sm">{item.values.summary}</p><p className="text-xs text-muted">Occurred {new Date(item.values.occurred_at).toLocaleString()} / recorded by {item.created_by}</p>
     {item.values.amount&&<p className="text-sm">Reported deal value: {item.values.amount.currency} {amountText(item.values.amount)}</p>}
     {item.values.source_reference&&<p className="text-sm break-words">Owner source reference: {item.values.source_reference}</p>}
     {item.values.attribution_note&&<p className="text-sm">Owner attribution: {item.values.attribution_note}</p>}
     <div className="flex flex-wrap gap-2"><button className={button} disabled={locked} onClick={()=>setEditing(item)}>Correct or withdraw outcome</button><button className={button} onClick={()=>setHistoryId(historyId===item.id?null:item.id)}>View outcome history</button></div>
     {historyId===item.id&&<div className="rounded-lg bg-soft p-3">{history.isPending?<p>Loading history...</p>:history.isError?<p role="alert">History is unavailable. <button className={button} onClick={()=>void history.refetch()}>Retry history</button></p>:history.data?.history.changes.map(change=><p key={change.id+":"+change.revision} className="text-sm">Revision {change.revision} / {human(change.status)} / {human(change.values.kind)} / {change.values.summary}</p>)}</div>}
    </article>):<p className="text-sm">No outcomes recorded. Message activity does not create a business result.</p>}
    {editing!==undefined&&<form key={editing?.id??"new-outcome"} onSubmit={saveOutcome} className="rounded-lg border border-line p-4"><fieldset disabled={locked} className="grid gap-3 sm:grid-cols-2">
     <legend className="font-medium">{editing?"Correct or withdraw recorded outcome":"Record owner-reported outcome"}</legend>
     <label className="text-sm">Outcome kind<select aria-label="Outcome kind" name="kind" defaultValue={editing?.values.kind??"QUALIFIED_CONVERSATION"} className={field}>{["QUALIFIED_CONVERSATION","MEETING_BOOKED","QUOTE_REQUESTED","WON","LOST"].filter(kind=>!editing||(editing.slot==="RESULT"?["WON","LOST"].includes(kind):kind===editing.values.kind)).map(kind=><option key={kind} value={kind}>{human(kind)}</option>)}</select></label>
     <label className="text-sm">Record status<select aria-label="Record status" name="status" defaultValue={editing?.status??"RECORDED"} className={field}><option value="RECORDED">Recorded</option>{editing&&<option value="WITHDRAWN">Withdrawn (preserve history)</option>}</select></label>
     <label className="text-sm">When the milestone happened<input name="occurred_at" type="datetime-local" required defaultValue={localTime(editing?.values.occurred_at??new Date().toISOString())} className={field}/></label>
     <label className="text-sm">Summary<textarea name="summary" required maxLength={2000} defaultValue={editing?.values.summary??""} className={field}/></label>
     <label className="text-sm">Source reference (optional)<input name="source_reference" maxLength={500} defaultValue={editing?.values.source_reference??""} className={field}/></label>
     <label className="text-sm">Evidence message ID (optional)<input name="evidence_message_id" defaultValue={editing?.values.evidence_message_id??""} className={field}/></label>
     <label className="text-sm">Attributed action ID (optional)<input name="attributed_action_id" defaultValue={editing?.values.attributed_action_id??""} className={field}/></label>
     <label className="text-sm">Attribution explanation (required with action)<textarea name="attribution_note" maxLength={2000} defaultValue={editing?.values.attribution_note??""} className={field}/></label>
     <label className="text-sm">Reported won deal value (optional)<input name="amount" inputMode="decimal" defaultValue={amountText(editing?.values.amount??null)} className={field}/></label>
     <label className="text-sm">Currency for deal value<input name="currency" maxLength={3} placeholder="INR" defaultValue={editing?.values.amount?.currency??""} className={field}/></label>
     <label className="text-sm sm:col-span-2">Reason for recording or correcting<textarea name="reason" required maxLength={2000} className={field}/></label>
     <div className="flex flex-wrap gap-2 sm:col-span-2"><button className={button}>Save outcome</button><button className={button} type="button" onClick={()=>setEditing(undefined)}>Close outcome editor</button></div>
    </fieldset></form>}
   </section>
  </>}
 </div>;
}
