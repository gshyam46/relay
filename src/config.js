import path from "node:path";

export function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT || 3000),
    databaseFile: env.DATABASE_FILE || path.join("data", "app.db")
  };
}
