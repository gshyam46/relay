import { existsSync, mkdirSync, renameSync } from "node:fs";
import path from "node:path";
import { createDatabase } from "../src/database/database.js";

const defaultDatabaseFile = path.resolve("data", "app.db");
const databaseFile = path.resolve(process.env.DATABASE_FILE || defaultDatabaseFile);

if (databaseFile !== defaultDatabaseFile && !process.argv.includes("--allow-custom")) {
  console.error("Refusing to reset a custom DATABASE_FILE without --allow-custom.");
  console.error(`Requested database: ${databaseFile}`);
  process.exit(1);
}

mkdirSync(path.dirname(databaseFile), { recursive: true });

if (existsSync(databaseFile)) {
  const backupDir = path.resolve("data", "backups");
  mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const backupFile = path.join(backupDir, `app-${stamp}.db`);
  renameSync(databaseFile, backupFile);
  console.log(`Backed up existing local database to ${backupFile}`);
}

const db = await createDatabase(databaseFile);
await db.close();
console.log(`Created clean local development database at ${databaseFile}`);
