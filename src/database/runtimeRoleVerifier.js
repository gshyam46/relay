import { runtimeManifest } from "./schemaVerifier.js";
const needed=["SELECT","INSERT","UPDATE","DELETE"];
const forbidden=["TRUNCATE","REFERENCES","TRIGGER"];
export async function verifyRuntimeRole(db) {
 if(db.kind==="sqlite")return {compatible:true,mode:"NOT_APPLICABLE",checked_tables:0,issues:[]};
 if(db.kind!=="postgres")throw failure();
 const issues=[],add=code=>{if(!issues.includes(code))issues.push(code);};
 const roles=await db.all(`SELECT r.rolsuper AS superuser,r.rolcreaterole AS create_role,r.rolcreatedb AS create_database,
 r.rolreplication AS replication,r.rolbypassrls AS bypass_rls,left(r.rolname,3)='pg_' AS predefined
 FROM pg_roles r WHERE r.rolname=current_user OR pg_has_role(current_user,r.oid,'MEMBER') LIMIT 10001`);
 if(!roles.length||roles.length>10000)add("ROLE_CATALOG_UNAVAILABLE");
 for(const row of roles)for(const field of ["superuser","create_role","create_database","replication","bypass_rls","predefined"])if(row[field]!==true&&row[field]!==false)add("ROLE_CATALOG_UNAVAILABLE");
 if(roles.some(r=>r.superuser||r.create_role||r.create_database||r.replication||r.bypass_rls||r.predefined))add("PRIVILEGED_ROLE");
 const ownership=await db.get(`SELECT
 EXISTS(SELECT 1 FROM pg_database d WHERE d.datname=current_database() AND (d.datdba=(SELECT oid FROM pg_roles WHERE rolname=current_user) OR pg_has_role(current_user,d.datdba,'MEMBER'))) AS database_owner,
 EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname=current_schema() AND (n.nspowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) OR pg_has_role(current_user,n.nspowner,'MEMBER'))) AS schema_owner,
 EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND c.relkind IN ('r','p') AND (c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) OR pg_has_role(current_user,c.relowner,'MEMBER'))) AS table_owner,
 has_database_privilege(current_user,current_database(),'CREATE') AS database_create,
 has_schema_privilege(current_user,current_schema(),'CREATE') AS schema_create,
 has_schema_privilege(current_user,current_schema(),'USAGE') AS schema_usage`);
 if(!ownership||["database_owner","schema_owner","table_owner","database_create","schema_create","schema_usage"].some(k=>ownership[k]!==true&&ownership[k]!==false))add("ROLE_CATALOG_UNAVAILABLE");
 if(ownership?.database_owner||ownership?.schema_owner||ownership?.table_owner)add("RUNTIME_OWNERSHIP");
 if(ownership?.database_create||ownership?.schema_create)add("RUNTIME_DDL_PRIVILEGE");
 if(ownership?.schema_usage!==true)add("RUNTIME_ACCESS_MISSING");
 const rows=await db.all(`SELECT c.relname AS table_name,
 has_table_privilege(current_user,c.oid,'SELECT') AS can_select,
 has_table_privilege(current_user,c.oid,'INSERT') AS can_insert,
 has_table_privilege(current_user,c.oid,'UPDATE') AS can_update,
 has_table_privilege(current_user,c.oid,'DELETE') AS can_delete,
 has_table_privilege(current_user,c.oid,'TRUNCATE') AS can_truncate,
 has_table_privilege(current_user,c.oid,'REFERENCES') AS can_references,
 has_table_privilege(current_user,c.oid,'TRIGGER') AS can_trigger,
 has_any_column_privilege(current_user,c.oid,'INSERT') AS column_insert,
 has_any_column_privilege(current_user,c.oid,'UPDATE') AS column_update,
 has_any_column_privilege(current_user,c.oid,'REFERENCES') AS column_references,
 has_table_privilege(current_user,c.oid,'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,DELETE WITH GRANT OPTION,TRUNCATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION,TRIGGER WITH GRANT OPTION') AS can_delegate
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname=current_schema() AND c.relkind IN ('r','p') LIMIT 257`);
 if(rows.length>256)add("ROLE_CATALOG_UNAVAILABLE");
 for(const table of runtimeManifest.tables){
  const row=rows.find(r=>r.table_name===table.name);
  if(!row){add("RUNTIME_ACCESS_MISSING");continue;}
  const fields=[...[...needed,...forbidden].map(p=>"can_"+p.toLowerCase()),"column_insert","column_update","column_references","can_delegate"];
  if(fields.some(k=>row[k]!==true&&row[k]!==false)){add("ROLE_CATALOG_UNAVAILABLE");continue;}
  const required=table.name==="schema_migrations"?["SELECT"]:needed;
  if(required.some(p=>row["can_"+p.toLowerCase()]!==true))add("RUNTIME_ACCESS_MISSING");
  if(row.column_references||row.can_delegate)add("RUNTIME_DDL_PRIVILEGE");
  if(table.name==="schema_migrations"&&(row.column_insert||row.column_update))add("MIGRATION_LEDGER_WRITE");
  const denied=table.name==="schema_migrations"?["INSERT","UPDATE","DELETE",...forbidden]:forbidden;
  if(denied.some(p=>row["can_"+p.toLowerCase()]===true))add(table.name==="schema_migrations"?"MIGRATION_LEDGER_WRITE":"RUNTIME_DDL_PRIVILEGE");
 }
 return {compatible:issues.length===0,mode:"POSTGRES_RUNTIME",checked_tables:runtimeManifest.tables.length,issues};
}
function failure(){return Object.assign(new Error("PostgreSQL runtime privileges are unsafe or incomplete. Use the separate reviewed application role."),{code:"DATABASE_RUNTIME_ROLE_UNSAFE"});}
export async function assertRuntimeRole(db){const result=await verifyRuntimeRole(db);if(!result.compatible)throw failure();return result;}
