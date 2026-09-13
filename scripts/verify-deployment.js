import path from "node:path";
import { pathToFileURL } from "node:url";
import { describeConfig, loadConfig, validateConfig } from "../src/config.js";
import { describeDatabaseFailure, getMigrationStatus, openDatabaseClient } from "../src/database/database.js";
import { assertRuntimeSchema } from "../src/database/schemaVerifier.js";
import { assertRuntimeRole } from "../src/database/runtimeRoleVerifier.js";
class VerificationFailure extends Error {}
// Reusable catalog check for explicit disposable fixtures. The deployed CLI also
// requires the effective runtime-role check below; fixture admin access is not proof.
export async function verifyDeploymentDatabase(db) {
 await db.get("SELECT 1 AS connected");
 const status=await getMigrationStatus(db);
 if(!status.initialized||!status.compatible||status.pending.length)throw new VerificationFailure("Migration history is uninitialized, pending or incompatible. Verification changed nothing.");
 const structure=await assertRuntimeSchema(db);
 return {...status,structure};
}
async function main(){
 let db;
 try{
  const config=loadConfig();
  if(config.database.driver!=="postgres")throw new VerificationFailure("DATABASE_URL must select PostgreSQL for deployment verification.");
  if(!config.isProductionLike)throw new VerificationFailure("Deployment verification requires staging or production configuration.");
  const problems=validateConfig(config);if(problems.length)throw new VerificationFailure(problems.join(" "));
  console.log(JSON.stringify({event:"deployment.verify_starting",config:describeConfig(config)}));
  db=await openDatabaseClient(config.database,{readOnly:true,requireExisting:true});
  const status=await verifyDeploymentDatabase(db),role=await assertRuntimeRole(db);
  console.log(JSON.stringify({event:"deployment.verify_complete",applied_migrations:status.applied.length,required_tables:status.structure.tables,checked_columns:status.structure.columns,checked_indexes:status.structure.indexes,checked_foreign_keys:status.structure.foreign_keys,runtime_privileges:role.compatible,read_only:true,note:"Current schema and effective application-role checks passed. PostgreSQL concurrency, provider and isolated restore evidence remain separate."}));
 }catch(error){const failure=error instanceof VerificationFailure?{code:"DEPLOYMENT_VERIFICATION_FAILED",message:error.message}:describeDatabaseFailure(error);console.error(JSON.stringify({event:"deployment.verify_failed",...failure}));process.exitCode=1;}
 finally{try{await db?.close();}catch(error){console.error(JSON.stringify({event:"deployment.verify_close_failed",...describeDatabaseFailure(error)}));process.exitCode=1;}}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();
