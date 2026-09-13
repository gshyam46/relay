import test from "node:test";
import assert from "node:assert/strict";
import {createDatabase,getMigrationStatus} from "../src/database/database.js";
import {generateSchemaManifest} from "../scripts/generate-schema-manifest.js";
import {runtimeManifest,verifyRuntimeSchema,assertRuntimeSchema} from "../src/database/schemaVerifier.js";
import {verifyRuntimeRole,assertRuntimeRole} from "../src/database/runtimeRoleVerifier.js";
import {postgresTestContext,connectTestAdmin,schemaFor,schemaDatabaseConfig} from "../scripts/helpers/testSafety.js";

async function fixture(t){const db=await createDatabase(":memory:");t.after(()=>db.close());return db;}
test("committed release manifest covers every migrated structure and remains reproducible",async t=>{
 const db=await fixture(t),generated=await generateSchemaManifest();
 assert.deepEqual(generated,runtimeManifest);
 const result=await assertRuntimeSchema(db);assert.equal(result.compatible,true);assert.equal(result.tables,82);assert.ok(result.columns>500);assert.ok(result.foreign_keys>100);assert.ok(result.indexes>100);
});
test("complete migration history cannot hide a removed current table",async t=>{
 const db=await fixture(t);await db.exec("DROP TABLE email_verification_receipts");
 assert.equal((await getMigrationStatus(db)).pending.length,0);
 const result=await verifyRuntimeSchema(db);assert.equal(result.compatible,false);assert.ok(result.issues.some(i=>i.code==="TABLE_MISSING"&&i.table==="email_verification_receipts"));
 await assert.rejects(assertRuntimeSchema(db),{code:"DATABASE_SCHEMA_INCOMPATIBLE"});
});
test("actual columns and ordered unique keys are verified beyond names",async t=>{
 const db=await fixture(t);await db.exec("ALTER TABLE leads DROP COLUMN source_metadata_json");
 assert.ok((await verifyRuntimeSchema(db)).issues.some(i=>i.code==="COLUMN_INCOMPATIBLE"&&i.table==="leads"));
 await db.exec("DROP INDEX idx_identity_resolution_created_lead; CREATE UNIQUE INDEX idx_identity_resolution_created_lead ON import_identity_resolutions(organization_id,id) WHERE decision='CREATE_SEPARATE'");
 assert.ok((await verifyRuntimeSchema(db)).issues.some(i=>i.code==="INDEX_INCOMPATIBLE"&&i.table==="import_identity_resolutions"));
});
test("changed partial predicate cannot satisfy the original authority index",async t=>{
 const db=await fixture(t);await db.exec("DROP INDEX idx_identity_resolution_created_lead; CREATE UNIQUE INDEX idx_identity_resolution_created_lead ON import_identity_resolutions(organization_id,lead_id) WHERE decision='LINK_EXISTING'");
 assert.equal((await verifyRuntimeSchema(db)).compatible,false);
});
test("missing scoped foreign-key evidence fails closed without schema repair",async t=>{
 const db=await fixture(t),all=db.all.bind(db);
 db.all=async(...args)=>args[0]==='PRAGMA foreign_key_list("conversation_revisions")'?[]:all(...args);
 for(const name of ["run","exec","transaction"])db[name]=()=>{throw new Error("Verification attempted a write.");};
 const result=await verifyRuntimeSchema(db);assert.ok(result.issues.some(i=>i.code==="FOREIGN_KEY_INCOMPATIBLE"&&i.table==="conversation_revisions"));
});
test("manifest release drift and excessive catalog sizes refuse readiness",async t=>{
 const db=await fixture(t);assert.equal((await verifyRuntimeSchema(db,{manifest:{...runtimeManifest,migration_ids:[]}})).compatible,false);
 const oversized={kind:"sqlite",all:async()=>Array.from({length:257},(_,i)=>({name:"untrusted_"+i}))};
 await assert.rejects(verifyRuntimeSchema(oversized),{code:"DATABASE_SCHEMA_INCOMPATIBLE"});
});
function roleFixture(){
 const state={roles:[{superuser:false,create_role:false,create_database:false,replication:false,bypass_rls:false,predefined:false}],ownership:{database_owner:false,schema_owner:false,table_owner:false,database_create:false,schema_create:false,schema_usage:true},rows:runtimeManifest.tables.map(t=>({table_name:t.name,can_select:true,can_insert:t.name!=="schema_migrations",can_update:t.name!=="schema_migrations",can_delete:t.name!=="schema_migrations",can_truncate:false,can_references:false,can_trigger:false,column_insert:t.name!=="schema_migrations",column_update:t.name!=="schema_migrations",column_references:false,can_delegate:false}))};
 return {state,db:{kind:"postgres",all:async sql=>sql.includes("FROM pg_roles")?state.roles:state.rows,get:async()=>state.ownership}};
}
test("role verifier allows read-only catalog checking of the explicit runtime CRUD contract",async()=>{
 const f=roleFixture();assert.equal((await assertRuntimeRole(f.db)).compatible,true);
 assert.deepEqual(await verifyRuntimeRole({kind:"sqlite"}),{compatible:true,mode:"NOT_APPLICABLE",checked_tables:0,issues:[]});
});
test("effective inherited privileged roles and ownership are refused",async()=>{
 for(const property of ["superuser","create_role","create_database","replication","bypass_rls","predefined"]){const f=roleFixture();f.state.roles.push({...f.state.roles[0],[property]:true});assert.ok((await verifyRuntimeRole(f.db)).issues.includes("PRIVILEGED_ROLE"));}
 for(const property of ["database_owner","schema_owner","table_owner"]){const f=roleFixture();f.state.ownership[property]=true;await assert.rejects(assertRuntimeRole(f.db),{code:"DATABASE_RUNTIME_ROLE_UNSAFE"});}
});
test("effective schema creation, migration writes, dangerous table grants and missing CRUD are refused",async()=>{
 const cases=[
 f=>f.state.ownership.schema_create=true,
 f=>f.state.ownership.database_create=true,
 f=>f.state.rows.find(r=>r.table_name==="schema_migrations").can_insert=true,
 f=>f.state.rows.find(r=>r.table_name==="schema_migrations").column_insert=true,
 f=>f.state.rows.find(r=>r.table_name==="schema_migrations").column_update=true,
 f=>f.state.rows.find(r=>r.table_name==="actions").column_references=true,
 f=>f.state.rows.find(r=>r.table_name==="actions").can_delegate=true,
 f=>delete f.state.roles[0].predefined,
 f=>f.state.rows.find(r=>r.table_name==="actions").can_trigger=true,
 f=>f.state.rows.find(r=>r.table_name==="contact_restrictions").can_select=false,
 f=>f.state.rows.find(r=>r.table_name==="actions").can_update=false,
 f=>f.state.roles[0].bypass_rls="false"
 ];
 for(const mutate of cases){const f=roleFixture();mutate(f);assert.equal((await verifyRuntimeRole(f.db)).compatible,false);}
});
const pg=postgresTestContext();
test("actual disposable PostgreSQL catalogs match the complete release structure",{skip:!pg},async t=>{
 const schema=schemaFor(pg.runId,"adapter"),admin=await connectTestAdmin(pg);
 t.after(async()=>{await admin.exec('DROP SCHEMA IF EXISTS "'+schema+'" CASCADE');await admin.close();});
 await admin.exec('CREATE SCHEMA "'+schema+'"');const db=await createDatabase(schemaDatabaseConfig(pg,schema));t.after(()=>db.close());
 const result=await verifyRuntimeSchema(db);assert.equal(result.compatible,true,JSON.stringify(result.issues));
 // The migration connection owns its objects and is intentionally not a runtime role.
 assert.equal((await verifyRuntimeRole(db)).compatible,false);
});
