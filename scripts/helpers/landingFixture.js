// Public-page verification stays on the existing owned, disposable, provider-free boundary.
import { startAnalysisJobsFixture } from "./analysisJobsFixture.js";
export async function startLandingFixture() {
  const fixture = await startAnalysisJobsFixture({ configured: false, automatic: false });
  return { ...fixture,
    async counts() {
      const result = {};
      for (const table of ["organizations", "leads", "actions", "action_executions", "pilot_interest_requests"]) result[table] = Number((await fixture.db.get("SELECT count(*) AS count FROM " + table)).count);
      return result;
    },
    async pilotRequests() { return fixture.db.all("SELECT request_key,name,email,company,workflow,channel,status FROM pilot_interest_requests ORDER BY created_at,id"); }
  };
}
