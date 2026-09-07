import { createApp } from "./api/app.js";
import { loadConfig } from "./config.js";
import { createDatabase } from "./database/database.js";

const config = loadConfig();
const db = createDatabase(config.databaseFile);
const app = createApp({ db });

app.listen(config.port, () => {
  console.log(`AI Lead Intelligence & Outbound Automation running at http://localhost:${config.port}`);
});
