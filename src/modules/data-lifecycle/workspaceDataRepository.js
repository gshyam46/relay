import { assertWorkspaceTransaction } from "../contact-policy/contactPolicyService.js";
import { canonicalContactsForLead, canonicalContact, RESTRICTION_REASONS } from "../contact-policy/contactPolicyContract.js";
import { INVENTORY_COLUMNS, SCOPED_TABLES, CUSTOMER_TABLES, DELETE_ORDER, exportColumns, exportOmissions, identifier, scopeSql } from "./workspaceDataInventory.js";
import { MAX_WORKSPACE_ROWS, MAX_WORKSPACE_BYTES, MAX_ERASURES, INVENTORY_VERSION, boundedFailure, stateInvalid, digest, validDigest, lifecycleError } from "./workspaceDataContract.js";
const PLAN_TABLES = new Set([...CUSTOMER_TABLES, "contact_restrictions", "workspace_dispatch_controls", "workspace_data_erasures"]);
export class WorkspaceDataRepository {
 constructor(db) { this.db = db; }
 async schema() {
  const tables = this.db.kind === "postgres" ? await this.db.all("SELECT table_name AS name FROM information_schema.tables WHERE table_schema=current_schema() AND table_type='BASE TABLE' ORDER BY table_name LIMIT 257") : await this.db.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name LIMIT 257");
  if (JSON.stringify(tables.map(r => r.name).sort()) !== JSON.stringify(Object.keys(INVENTORY_COLUMNS).sort())) throw lifecycleError("WORKSPACE_DATA_INVENTORY_CHANGED", "Database inventory changed. Review this release's data lifecycle contract.", 503);
  for (const { name } of tables) {
   const cols = this.db.kind === "postgres" ? await this.db.all("SELECT column_name AS name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=? ORDER BY column_name", [name]) : await this.db.all("PRAGMA table_info(" + identifier(name) + ")");
   if (JSON.stringify(cols.map(c => c.name).sort()) !== JSON.stringify(INVENTORY_COLUMNS[name])) throw lifecycleError("WORKSPACE_DATA_INVENTORY_CHANGED", "Database inventory changed. Review this release's data lifecycle contract.", 503);
  }
  if (DELETE_ORDER.length !== new Set(DELETE_ORDER).size || CUSTOMER_TABLES.some(t => !DELETE_ORDER.includes(t)) || DELETE_ORDER.some(t => !CUSTOMER_TABLES.includes(t))) throw stateInvalid();
 }
 async metadata(org, { enforceLimit = true } = {}) {
  assertWorkspaceTransaction(this.db, org); await this.schema();
  const tables = []; let totalRows = 0, totalBytes = 0;
  for (const table of SCOPED_TABLES) {
   const byte = col => this.db.kind === "postgres" ? "octet_length(CAST(" + identifier(col) + " AS TEXT))" : "length(CAST(" + identifier(col) + " AS BLOB))";
   // SQL computes sizes without materializing any legacy body or secret value.
   const expression = INVENTORY_COLUMNS[table].map(c => "COALESCE(" + byte(c) + ",0)").join("+");
   const value = await this.db.get("SELECT COUNT(*) AS n,COALESCE(SUM(" + expression + "),0) AS bytes FROM " + identifier(table) + " WHERE " + scopeSql(table), [org]);
   const count = Number(value.n), bytes = Number(value.bytes);
   if (!Number.isSafeInteger(count) || !Number.isSafeInteger(bytes) || count < 0 || bytes < 0) throw stateInvalid();
   totalRows += count; totalBytes += bytes;
   tables.push({ table, count, source_bytes: bytes, erased: CUSTOMER_TABLES.includes(table), export_omissions: exportOmissions(table) });
  }
  const within_limits = totalRows <= MAX_WORKSPACE_ROWS && totalBytes <= MAX_WORKSPACE_BYTES;
  if (enforceLimit && !within_limits) throw boundedFailure();
  if ((tables.find(t => t.table === "workspace_data_erasures")?.count || 0) > MAX_ERASURES) throw lifecycleError("WORKSPACE_DATA_HISTORY_LIMIT", "Workspace erasure history requires operational inspection.");
  return { tables, total_rows: totalRows, source_bytes: totalBytes, within_limits };
 }
 async load(org, metadata) {
  assertWorkspaceTransaction(this.db, org);
  const rows = {};
  for (const { table, count } of metadata.tables) {
   const columns = PLAN_TABLES.has(table) ? INVENTORY_COLUMNS[table] : exportColumns(table);
   if (!columns.length || !count) { rows[table] = []; continue; }
   rows[table] = await this.db.all("SELECT " + columns.map(identifier).join(",") + " FROM " + identifier(table) + " WHERE " + scopeSql(table) + " ORDER BY " + columns.map(identifier).join(",") + " LIMIT " + (MAX_WORKSPACE_ROWS + 1), [org]);
   if (rows[table].length !== count) throw stateInvalid();
  }
  return rows;
 }
 planState(rows) { return Object.fromEntries([...PLAN_TABLES].sort().map(t => [t, rows[t]])); }
 publicRecords(rows) { return Object.fromEntries(SCOPED_TABLES.filter(t => exportColumns(t).length).map(t => [t, rows[t].map(row => Object.fromEntries(exportColumns(t).map(c => [c, row[c]])))])); }
 async holds(org) {
  assertWorkspaceTransaction(this.db, org); const checks = [
   ["WORKSPACE_DATA_PROVIDER_ACTIVE", "SELECT COUNT(*) n FROM actions a WHERE a.organization_id=? AND (a.status='EXECUTING' OR a.execution_hold_reason IN ('LEGACY_OUTCOME_REVIEW_REQUIRED','OUTCOME_REVIEW_REQUIRED') OR EXISTS (SELECT 1 FROM action_executions e WHERE e.action_id=a.id AND (e.outcome_class IS NULL OR e.outcome_class IN ('DISPATCHING','UNCERTAIN','CLOSED_UNRESOLVED') OR (e.outcome_class='LEGACY_UNKNOWN' AND e.status<>'COMPLETED'))))"],
   ["WORKSPACE_DATA_EVENT_ACTIVE", "SELECT COUNT(*) n FROM domain_events WHERE organization_id=? AND (status='PROCESSING' OR lease_owner IS NOT NULL)"],
   ["WORKSPACE_DATA_RECEIPT_ACTIVE", "SELECT COUNT(*) n FROM webhook_receipts WHERE organization_id=? AND (processing_state='PROCESSING' OR lease_owner IS NOT NULL)"],
   ["WORKSPACE_DATA_POLICY_PENDING", "SELECT COUNT(*) n FROM webhook_receipts WHERE organization_id=? AND mandatory_policy_status='PENDING'"],
   ["WORKSPACE_DATA_AI_ACTIVE", "SELECT COUNT(*) n FROM ai_provider_attempts WHERE organization_id=? AND request_state IN ('ADMITTED','UNCONFIRMED')"],
   ["WORKSPACE_DATA_CHECK_ACTIVE", "SELECT COUNT(*) n FROM email_verification_checks WHERE organization_id=? AND state='RUNNING'"],
   ["WORKSPACE_DATA_SCHEDULER_ACTIVE", "SELECT COUNT(*) n FROM scheduler_workspaces WHERE organization_id=? AND lease_owner IS NOT NULL"]
  ]; const holds=[];
  for (const [code, sql] of checks) { const count=Number((await this.db.get(sql,[org])).n); if(count) holds.push({code,count}); }
  return holds;
 }
 byRequest(org, key) { return this.db.get("SELECT * FROM workspace_data_erasures WHERE organization_id=? AND request_key=?", [org, key]); }
 async history(org, before, limit) {
  const params=[org], predicate=before ? " AND (completed_at<? OR (completed_at=? AND id<?))" : "";
  if(before) params.push(before.completed_at,before.completed_at,before.id);
  return this.db.all("SELECT * FROM workspace_data_erasures WHERE organization_id=?" + predicate + " ORDER BY completed_at DESC,id DESC LIMIT " + (limit+1),params);
 }
 async erase(org, rows, { id, actor_id, at }) {
  assertWorkspaceTransaction(this.db,org);
  const restrictions = retainedRestrictions(rows.contact_restrictions,rows.leads,id,org,at);
  await this.db.run("DELETE FROM contact_restrictions WHERE organization_id=?",[org]);
  // Break only reviewed pointer cycles; FKs remain enabled throughout.
  await this.db.run("UPDATE actions SET current_revision_id=NULL,active_execution_id=NULL,workflow_run_id=NULL WHERE organization_id=?",[org]);
  await this.db.run("UPDATE workflow_runs SET last_action_id=NULL WHERE organization_id=?",[org]);
  const counts={};
  for(const table of DELETE_ORDER) counts[table]=Number((await this.db.run("DELETE FROM "+identifier(table)+" WHERE "+scopeSql(table),[org])).changes);
  counts.contact_restrictions = rows.contact_restrictions.length;
  for(const r of restrictions) await this.db.run("INSERT INTO contact_restrictions(id,organization_id,contact_kind,contact_value,channel,reason,source,source_event_id,lead_id,actor_id,effective_at,created_at) VALUES (?,?,?,?,?,?,'MANUAL',?,NULL,NULL,?,?)",[r.id,org,r.contact_kind,r.contact_value,r.channel,r.reason,r.source_event_id,r.effective_at,at]);
  const prior=rows.workspace_dispatch_controls[0];
  const revision=prior?.revision || 0;
  if(!Number.isSafeInteger(revision)||revision<0||revision>=Number.MAX_SAFE_INTEGER) throw stateInvalid();
  await this.db.run("INSERT INTO workspace_dispatch_controls(organization_id,revision,paused,daily_attempt_limit,unresolved_limit,reason,updated_at,updated_by) VALUES (?,?,1,100,2,?,?,?) ON CONFLICT(organization_id) DO UPDATE SET revision=excluded.revision,paused=1,daily_attempt_limit=100,unresolved_limit=2,reason=excluded.reason,updated_at=excluded.updated_at,updated_by=excluded.updated_by",[org,revision+1,"Workspace customer data was erased. Review setup before resuming sending.",at,actor_id]);
  return { counts, retained_suppression_count: restrictions.length };
 }
}
function retainedRestrictions(existing,leads,id,org,at) {
 const byId=new Map(leads.map(l=>[l.id,l])), result=new Map();
 const add=(contact,r)=>{
  if(!contact || contact.kind==='LEAD') return;
  if(!RESTRICTION_REASONS.includes(r.reason)||!["ALL","EMAIL","WHATSAPP","SMS","VOICE"].includes(r.channel)||typeof r.effective_at!=="string"||!Number.isFinite(Date.parse(r.effective_at))) throw stateInvalid();
  const key=JSON.stringify([contact.kind,contact.value,r.channel,r.reason]), previous=result.get(key), effective=new Date(r.effective_at).toISOString();
  if(previous && previous.effective_at<=effective) return;
  const reference="workspace-erasure:"+id+":"+digest([r.channel,r.reason]).slice(0,16);
  result.set(key,{id:"restriction_"+digest([org,id,key]),contact_kind:contact.kind,contact_value:contact.value,channel:r.channel,reason:r.reason,source_event_id:reference,effective_at:effective,created_at:at});
 };
 for(const r of existing) {
  if(r.contact_kind==='LEAD') {const lead=byId.get(r.contact_value);if(!lead) throw stateInvalid();for(const c of canonicalContactsForLead(lead)) add(c,r);}
  else {const c=canonicalContact(r.contact_kind,r.contact_value);if(!c)throw stateInvalid();add(c,r);}
 }
 // Preserve legacy lifecycle stops even when no earlier restriction row exists.
 for(const lead of leads) if(['OPTED_OUT','SUPPRESSED'].includes(lead.status)) for(const c of canonicalContactsForLead(lead)) add(c,{channel:'ALL',reason:lead.status==='OPTED_OUT'?'OPT_OUT':'SUPPRESSED',effective_at:lead.updated_at||lead.created_at});
 if(result.size>MAX_WORKSPACE_ROWS) throw boundedFailure();
 return [...result.values()].sort((a,b)=>a.id.localeCompare(b.id));
}
export function publicErasure(row) {
 if(!row || row.inventory_version!==INVENTORY_VERSION || typeof row.erased_counts_json!=="string" || Buffer.byteLength(row.erased_counts_json)>32768 || !validDigest(row.plan_hash) || !validDigest(row.request_hash) || !Number.isSafeInteger(row.retained_suppression_count) || row.retained_suppression_count<0 || row.retained_suppression_count>MAX_WORKSPACE_ROWS || typeof row.completed_at!=="string" || !Number.isFinite(Date.parse(row.completed_at)) || new Date(row.completed_at).toISOString()!==row.completed_at) throw stateInvalid();
 let counts;try{counts=JSON.parse(row.erased_counts_json);}catch{throw stateInvalid();}
 if(!counts||Array.isArray(counts)||Object.keys(counts).some(k=>!DELETE_ORDER.includes(k)&&k!=="contact_restrictions")||Object.values(counts).some(n=>!Number.isSafeInteger(n)||n<0||n>MAX_WORKSPACE_ROWS))throw stateInvalid();
 return {id:row.id,request_key:row.request_key,inventory_version:row.inventory_version,plan_hash:row.plan_hash,erased_counts:counts,retained_suppression_count:row.retained_suppression_count,completed_at:row.completed_at,completed_by:row.completed_by};
}
