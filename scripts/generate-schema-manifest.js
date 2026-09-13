import { writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createDatabase } from "../src/database/database.js";
import { MIGRATIONS } from "../src/database/migrations/index.js";
import { inspectRuntimeSchema,schemaFingerprint } from "../src/database/schemaVerifier.js";

export async function generateSchemaManifest() {
 const db=await createDatabase(":memory:");
 try{return {version:1,migration_ids:MIGRATIONS.map(m=>m.id),...(await inspectRuntimeSchema(db))};}
 finally{await db.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 if(process.argv.slice(2).some(a=>a!=="--write")||process.argv.slice(2).length>1)throw new Error("Only --write is supported.");
 const manifest=await generateSchemaManifest();
 if(process.argv.includes("--write"))writeFileSync(new URL("../src/database/runtimeSchemaManifest.json",import.meta.url),JSON.stringify(manifest,null,2)+"\n");
 console.log(JSON.stringify({event:"schema.manifest_generated",written:process.argv.includes("--write"),tables:manifest.tables.length,migrations:manifest.migration_ids.length,fingerprint:schemaFingerprint(manifest)}));
}
