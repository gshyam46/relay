import {backupSqlite,parseRecoveryArguments,safeRecoveryFailure} from "./helpers/databaseRecovery.js";
try{const result=await backupSqlite(parseRecoveryArguments(process.argv.slice(2),"backup"));console.log(JSON.stringify({event:"database.backup_verified",status:result.status,bytes:result.bytes,sha256:result.sha256,tables:Object.keys(result.table_counts).length,outbound_enabled:false,worker_enabled:false}));}
catch(error){console.error(JSON.stringify({event:"database.backup_failed",...safeRecoveryFailure(error)}));process.exitCode=1;}
