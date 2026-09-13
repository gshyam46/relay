import {restoreSqliteDrill,parseRecoveryArguments,safeRecoveryFailure} from "./helpers/databaseRecovery.js";
try{const result=await restoreSqliteDrill(parseRecoveryArguments(process.argv.slice(2),"restore"));console.log(JSON.stringify({event:"database.restore_drill_verified",status:result.status,artifact_sha256:result.artifact_sha256,tables:Object.keys(result.table_counts).length,outbound_enabled:false,worker_enabled:false,application_started:false}));}
catch(error){console.error(JSON.stringify({event:"database.restore_drill_failed",...safeRecoveryFailure(error)}));process.exitCode=1;}
