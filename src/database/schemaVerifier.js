import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { MIGRATIONS } from "./migrations/index.js";

export const runtimeManifest = JSON.parse(readFileSync(new URL("./runtimeSchemaManifest.json", import.meta.url), "utf8"));
const LIMITS = { tables: 256, columns: 10000, indexes: 5000, foreign_keys: 5000 };
const identifier = value => '"' + String(value).replaceAll('"', '""') + '"';
const key = value => JSON.stringify(value);
const ordered = rows => rows.sort((a,b) => key(a).localeCompare(key(b)));
function failure() { return Object.assign(new Error("Required database structures are missing or incompatible with this release."), {code:"DATABASE_SCHEMA_INCOMPATIBLE"}); }
function bounded(rows, kind) { if (!Array.isArray(rows) || rows.length > LIMITS[kind]) throw failure(); return rows; }
function type(value) {
  const upper = String(value).toUpperCase();
  if (["INTEGER","INT","INT4","INT8","BIGINT","SMALLINT","INT2"].includes(upper)) return "INTEGER";
  if (["REAL","FLOAT4","FLOAT8","DOUBLE PRECISION"].includes(upper)) return "REAL";
  if (["TEXT","VARCHAR","CHARACTER VARYING"].includes(upper)) return "TEXT";
  if (["NUMERIC","DECIMAL"].includes(upper)) return "NUMERIC";
  if (["BOOLEAN","BOOL"].includes(upper)) return "BOOLEAN";
  if (["BLOB","BYTEA"].includes(upper)) return "BLOB";
  return upper;
}
function predicate(value) {
  if (!value) return null;
  // PostgreSQL adds casts/grouping to plain SQLite predicates. Preserve literal
  // bytes/case while normalizing only SQL syntax outside quoted strings.
  return String(value).split(/('(?:''|[^'])*')/g).map((part,i) => i%2 ? part : part.replace(/::(?:text|integer|bigint|numeric|character varying)\b/gi,"").replace(/[\s"()]/g,"").toLowerCase()).join("");
}
function canonicalTable(t) {
  return {name:t.name, columns:t.columns.sort((a,b)=>a.name.localeCompare(b.name)),
    indexes:ordered(t.indexes), foreign_keys:ordered(t.foreign_keys)};
}
export function schemaFingerprint(catalog) { return createHash("sha256").update(JSON.stringify(catalog.tables)).digest("hex"); }
export async function inspectRuntimeSchema(db) {
  if (db.kind === "sqlite") return inspectSqlite(db);
  if (db.kind === "postgres") return inspectPostgres(db);
  throw failure();
}
async function inspectSqlite(db) {
  const rows = bounded(await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name LIMIT 257"),"tables"), tables=[];
  let columnCount=0,indexCount=0,fkCount=0;
  for(const {name} of rows) {
    const columns=await db.all("PRAGMA table_info("+identifier(name)+")");
    columnCount+=columns.length;
    const indexRows=await db.all("PRAGMA index_list("+identifier(name)+")"), indexes=[];
    indexCount+=indexRows.length;
    for(const row of indexRows) {
      const parts=(await db.all("PRAGMA index_xinfo("+identifier(row.name)+")")).filter(p=>p.key===1);
      if(parts.some(p=>typeof p.name!=="string")) throw failure();
      const sql=await db.get("SELECT sql FROM sqlite_master WHERE type='index' AND name=?",[row.name]);
      const match=/\bWHERE\b([\s\S]*)$/i.exec(sql?.sql||"");
      indexes.push({name:row.origin==="c"?row.name:null,unique:row.unique===1,columns:parts.map(p=>({name:p.name,desc:p.desc===1})),where:predicate(match?.[1])});
    }
    const foreignRows=await db.all("PRAGMA foreign_key_list("+identifier(name)+")"), groups=new Map();
    for(const row of foreignRows){const group=groups.get(row.id)||[];group.push(row);groups.set(row.id,group);}
    const foreign_keys=[...groups.values()].map(group=>{group.sort((a,b)=>a.seq-b.seq);return {columns:group.map(r=>r.from),table:group[0].table,references:group.map(r=>r.to),on_delete:group[0].on_delete,on_update:group[0].on_update};});
    fkCount+=foreign_keys.length;
    tables.push(canonicalTable({name,columns:columns.map(c=>({name:c.name,type:type(c.type),required:!!c.notnull||c.pk>0})),indexes,foreign_keys}));
  }
  if(columnCount>LIMITS.columns||indexCount>LIMITS.indexes||fkCount>LIMITS.foreign_keys)throw failure();
  return {tables};
}
async function inspectPostgres(db) {
  const rows=bounded(await db.all("SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND c.relkind IN ('r','p') ORDER BY c.relname LIMIT 257"),"tables");
  const columns=bounded(await db.all("SELECT c.relname AS table_name,a.attname AS name,t.typname AS type,a.attnotnull AS required FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_type t ON t.oid=a.atttypid WHERE n.nspname=current_schema() AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum LIMIT 10001"),"columns");
  const indexes=bounded(await db.all(`SELECT c.relname AS table_name,ic.relname AS name,i.indisunique AS unique,i.indisvalid AS valid,i.indisready AS ready,
    EXISTS(SELECT 1 FROM pg_constraint q WHERE q.conindid=i.indexrelid AND q.contype IN ('p','u')) AS automatic,
    pg_get_expr(i.indpred,i.indrelid) AS predicate,
    (SELECT json_agg(json_build_object('name',a.attname,'desc',(i.indoption[k.position-1] & 1)=1) ORDER BY k.position)
     FROM unnest(i.indkey) WITH ORDINALITY AS k(attribute,position)
     LEFT JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.attribute WHERE k.position<=i.indnkeyatts) AS columns
    FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_class ic ON ic.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=current_schema() ORDER BY c.relname,ic.relname LIMIT 5001`),"indexes");
  const fks=bounded(await db.all(`SELECT c.relname AS table_name,rc.relname AS referenced_table,q.convalidated AS valid,
    rn.nspname=current_schema() AS scoped,q.confdeltype AS on_delete,q.confupdtype AS on_update,
    (SELECT json_agg(a.attname ORDER BY k.position) FROM unnest(q.conkey) WITH ORDINALITY k(attribute,position) JOIN pg_attribute a ON a.attrelid=q.conrelid AND a.attnum=k.attribute) AS columns,
    (SELECT json_agg(a.attname ORDER BY k.position) FROM unnest(q.confkey) WITH ORDINALITY k(attribute,position) JOIN pg_attribute a ON a.attrelid=q.confrelid AND a.attnum=k.attribute) AS references
    FROM pg_constraint q JOIN pg_class c ON c.oid=q.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_class rc ON rc.oid=q.confrelid JOIN pg_namespace rn ON rn.oid=rc.relnamespace
    WHERE n.nspname=current_schema() AND q.contype='f' ORDER BY c.relname,q.conname LIMIT 5001`),"foreign_keys");
  const action={a:"NO ACTION",r:"RESTRICT",c:"CASCADE",n:"SET NULL",d:"SET DEFAULT"};
  const tables=rows.map(({name})=>canonicalTable({name,
    columns:columns.filter(c=>c.table_name===name).map(c=>({name:c.name,type:type(c.type),required:c.required===true})),
    indexes:indexes.filter(i=>i.table_name===name).map(i=>({name:i.automatic?null:i.name,unique:i.unique===true,columns:i.columns,where:predicate(i.predicate),...(!(i.valid===true&&i.ready===true)?{invalid:true}:{})})),
    foreign_keys:fks.filter(f=>f.table_name===name).map(f=>({columns:f.columns,table:f.referenced_table,references:f.references,on_delete:action[f.on_delete],on_update:action[f.on_update],...(!(f.valid===true&&f.scoped===true)?{invalid:true}:{})}))
  }));
  return {tables};
}
export async function verifyRuntimeSchema(db,{manifest=runtimeManifest}={}) {
  const issues=[];
  const issue=(code,table=null)=>{if(issues.length<50)issues.push({code,table});};
  if(manifest?.version!==1||!Array.isArray(manifest.tables)||key(manifest.migration_ids)!==key(MIGRATIONS.map(m=>m.id)))issue("MANIFEST_RELEASE_MISMATCH");
  const current=await inspectRuntimeSchema(db);
  for(const expected of manifest?.tables||[]) {
    const found=current.tables.find(t=>t.name===expected.name);
    if(!found){issue("TABLE_MISSING",expected.name);continue;}
    for(const column of expected.columns){const actual=found.columns.find(c=>c.name===column.name);if(!actual||actual.type!==column.type||(column.required&&!actual.required))issue("COLUMN_INCOMPATIBLE",expected.name);}
    for(const index of expected.indexes)if(!found.indexes.some(i=>key(i)===key(index)))issue("INDEX_INCOMPATIBLE",expected.name);
    for(const fk of expected.foreign_keys)if(!found.foreign_keys.some(f=>key(f)===key(fk)))issue("FOREIGN_KEY_INCOMPATIBLE",expected.name);
  }
  const totals={tables:current.tables.length,columns:0,indexes:0,foreign_keys:0};
  for(const t of current.tables)for(const k of ["columns","indexes","foreign_keys"])totals[k]+=t[k].length;
  return {compatible:issues.length===0,manifest_version:manifest?.version??null,...totals,issues};
}
export async function assertRuntimeSchema(db) {const result=await verifyRuntimeSchema(db);if(!result.compatible)throw failure();return result;}
