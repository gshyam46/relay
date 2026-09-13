import {LoadingState} from "@/components/loading-screen";
import {ReplyInterpretation} from "@/components/reply-interpretation";
import type {ReplyInterpretation as Interpretation} from "@/types/intelligence-generation";
import {useState} from "react";
import {useQuery} from "@tanstack/react-query";
import {Link} from "react-router-dom";
import {Header} from "@/components/layout/header";
import {api} from "@/lib/api";
import {CustomerWorkflow} from "@/components/customer-workflow";
import {MessageComposer} from "@/components/message-composer";
const button="rounded-lg border border-line px-3 py-2 text-sm disabled:opacity-50";
type Entry={lead:{id:string;name:string};conversation:{attention:string;read_state:string;effective_status:string;inbound_count:number;assigned_owner_id:string|null}};
type Directory={conversations:Entry[];has_more:boolean;next_after_lead_id:string|null};
type Message={id:string;direction:string;channel:string;status:string;subject:string|null;body:string|null;occurred_at:string;metadata_unavailable?:boolean;interpretation?:Interpretation|null};
type Page={messages:Message[];has_more:boolean;next_after_id:string|null};
function label(value:string){return value.toLowerCase().replaceAll("_"," ");}
export function ConversationsPage(){
 const [after,setAfter]=useState<string|null>(null),[selected,setSelected]=useState<Entry|null>(null),[search,setSearch]=useState(""),[attention,setAttention]=useState("ALL");
 const query=useQuery({queryKey:["customer-workflow","inbox",after],queryFn:()=>api.get<Directory>("/customer-workflow/conversations"+(after?"?after_lead_id="+encodeURIComponent(after):"")),refetchInterval:30000});
 const visible=query.data?.conversations.filter(item=>(!search||item.lead.name.toLowerCase().includes(search.toLowerCase()))&&(attention==="ALL"||attention==="UNREAD"&&item.conversation.read_state==="UNREAD"||item.conversation.attention===attention))??[];
 return <><Header title="Conversations"/><main className="flex-1 min-h-0 overflow-auto p-4 sm:p-6">
  <p className="mb-4 text-sm text-muted">Enquiries are listed in stable pages. Attention and unread state reflect recorded inbound messages. Sending or drafting does not resolve an enquiry.</p>
  <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
   <section aria-label="Enquiry conversation directory" className="space-y-3">
    <label className="block text-sm">Find on this page<input className="mt-1 w-full rounded-lg border border-line bg-surface p-2" value={search} onChange={event=>setSearch(event.target.value)}/></label>
    <label className="block text-sm">Attention on this page<select className="mt-1 w-full rounded-lg border border-line bg-surface p-2" value={attention} onChange={event=>setAttention(event.target.value)}>{["ALL","UNREAD","NEEDS_REPLY","ESCALATED","RESOLVED","CONTACT_RESTRICTED","CONTACT_POLICY_PENDING","CONTACT_UNRESOLVED"].map(value=><option key={value} value={value}>{label(value)}</option>)}</select></label>
    <button className={button} disabled={query.isFetching} onClick={()=>void query.refetch()}>Refresh inbox</button>
    {query.isPending?<LoadingState label="Loading enquiries" />:query.isError?<p role="alert">The conversation directory is unavailable. Refresh the inbox to retry.</p>:<>
     {visible.length?visible.map(item=><button key={item.lead.id} onClick={()=>setSelected(item)} className={"block w-full text-left rounded-xl border p-3 bg-surface "+(selected?.lead.id===item.lead.id?"border-brand":"border-line")} aria-pressed={selected?.lead.id===item.lead.id}>
      <span className="block font-medium">{item.lead.name}</span><span className="block text-xs text-muted mt-1">{label(item.conversation.attention)} / {label(item.conversation.read_state)} / {item.conversation.inbound_count} inbound</span>
     </button>):<p className="text-sm">No enquiries match this page. <Link className="underline" to="/leads">Open lead directory</Link></p>}
     <div className="flex flex-wrap gap-2">{after&&<button className={button} onClick={()=>setAfter(null)}>First enquiry page</button>}{query.data?.has_more&&<button className={button} onClick={()=>setAfter(query.data.next_after_lead_id)}>Next enquiry page</button>}</div>
    </>}
   </section>
   {selected?<Conversation key={selected.lead.id} entry={selected}/>:<section className="rounded-xl border border-line bg-surface p-6"><h2 className="font-semibold">Choose an enquiry</h2><p className="mt-2 text-sm text-muted">Read original messages, prepare a reviewed reply and record who owns the next step. Enquiries without messages can still have internal reminders.</p></section>}
  </div>
 </main></>;
}
function Conversation({entry}:{entry:Entry}){
 const [after,setAfter]=useState<string|null>(null),[reply,setReply]=useState<string|null|undefined>(undefined);
 const query=useQuery({queryKey:["customer-workflow",entry.lead.id,"messages",after],queryFn:()=>api.get<Page>("/leads/"+encodeURIComponent(entry.lead.id)+"/conversation/messages"+(after?"?after_id="+encodeURIComponent(after):"")),refetchInterval:30000});
 return <section className="min-w-0 space-y-4" aria-label={"Conversation with "+entry.lead.name}>
  <div className="flex flex-wrap items-center gap-3"><h2 className="text-lg font-semibold mr-auto">{entry.lead.name}</h2><Link className={button} to={"/leads/"+encodeURIComponent(entry.lead.id)+"?tab=customer-workflow"}>Reminders and outcomes</Link><button className={button} onClick={()=>setReply(null)}>Write new message</button></div>
  <p className="text-xs text-muted">Messages are associated with this enquiry. Provider transport threading is shown only when separately verified.</p>
  {query.isPending?<LoadingState label="Loading messages" />:query.isError?<p role="alert">Messages could not be loaded. <button className={button} onClick={()=>void query.refetch()}>Retry messages</button></p>:<div className="space-y-3">
   {query.data.messages.length?[...query.data.messages].reverse().map(message=><article key={message.id} className={"rounded-xl border border-line p-4 "+(message.direction==="INBOUND"?"bg-soft":"bg-surface")}>
    <div className="flex flex-wrap gap-2 text-xs text-muted"><span>{message.direction==="INBOUND"?"Original message":"Recorded outbound message"}</span><span>{label(message.channel)}</span><time dateTime={message.occurred_at}>{new Date(message.occurred_at).toLocaleString()}</time><span>{label(message.status)}</span></div>
    {message.subject&&<p className="font-medium mt-2">{message.subject}</p>}<p className="whitespace-pre-wrap break-words text-sm mt-2">{message.body||"Original message text is unavailable."}</p>
    <details className="mt-2 text-xs"><summary className="cursor-pointer">Message reference</summary><p className="break-all">{message.id}</p><p>Recorded message history is preserved independently of owner outcomes.</p></details>
    {message.direction==="INBOUND"&&<ReplyInterpretation interpretation={message.interpretation} original={message.body||""}/>}
    {message.metadata_unavailable&&<p className="mt-2 text-xs">Interpretation metadata is unavailable; the original text is shown.</p>}
    {message.direction==="INBOUND"&&message.channel==="EMAIL"&&<button className={button+" mt-3"} onClick={()=>setReply(message.id)}>Write reviewed reply</button>}
   </article>):<p className="rounded-lg border border-line p-4 text-sm">No messages on this page. Create a reviewed first message when contact policy permits it.</p>}
   <div className="flex flex-wrap gap-2">{after&&<button className={button} onClick={()=>setAfter(null)}>Latest messages</button>}{query.data.has_more&&<button className={button} onClick={()=>setAfter(query.data.next_after_id)}>Older messages</button>}</div>
  </div>}
  <CustomerWorkflow leadId={entry.lead.id} conversationOnly/>
  {reply!==undefined&&<MessageComposer leadId={entry.lead.id} replyToMessageId={reply} onClose={()=>{setReply(undefined);void query.refetch();}}/>}
 </section>;
}
