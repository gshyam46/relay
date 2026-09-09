// Boots the real server on an isolated port and database for end-to-end
// verification, so a manual/automated browser pass never touches the local
// development database (or collides with a dev server already on port 3000).
process.env.PORT = process.env.E2E_PORT || "3100";
process.env.DATABASE_FILE = process.env.E2E_DATABASE_FILE || "data/e2e-verify.db";
process.env.LOG_FORMAT = process.env.LOG_FORMAT || "text";

await import("../src/server.js");
