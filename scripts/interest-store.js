import path from "node:path";
import { readFile, lstat } from "node:fs/promises";
import { openInterestDatabase } from "../deployment/interest-store.js";
import { PilotInterestOperations } from "../src/modules/public-interest/pilotInterestOperations.js";
let connection;
try {
  const [operation, inputFile] = process.argv.slice(2);
  if (!["list", "preview-purge", "mark", "purge"].includes(operation) || process.argv.length > 4) throw new Error("Invalid command");
  let input = {};
  if (["mark", "purge"].includes(operation) && !inputFile) throw new Error("A command file is required");
  if (inputFile) {
    if (!inputFile || !path.isAbsolute(inputFile)) throw new Error("An absolute command file is required");
    const info = await lstat(inputFile);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 1048576) throw new Error("Invalid input file");
    input = JSON.parse(await readFile(inputFile, "utf8"));
  }
  connection = await openInterestDatabase();
  const service = new PilotInterestOperations(connection.db);
  const result = operation === "list" ? await service.list({ status: "NEW", limit: 50, ...input }) : operation === "preview-purge" ? await service.previewPurge({ limit: 1000, ...input }) : await service[operation](input);
  console.log(JSON.stringify(result, null, 2));
} catch { console.error("Interest operation failed. Use list|preview-purge|mark|purge with an explicit INTEREST_DATABASE_URL for the acquisition store. mark/purge require an absolute JSON command file. Review the documented operator permissions; no default database or automatic migration is used."); process.exitCode = 1; }
finally { await connection?.close(); }
