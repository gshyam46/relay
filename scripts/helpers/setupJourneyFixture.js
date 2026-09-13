import { startAnalysisJobsFixture } from "./analysisJobsFixture.js";

export async function startSetupJourneyFixture() {
  const fixture = await startAnalysisJobsFixture({ configured: false, automatic: false });
  return { ...fixture,
    async counts() {
      const result = {};
      for (const table of ["actions", "action_revisions", "action_executions", "analysis_jobs", "intelligence_snapshots", "channel_messages", "business_outcome_revisions", "follow_up_tasks", "email_verification_runs"]) result[table] = Number((await fixture.db.get("SELECT count(*) n FROM " + table)).n);
      return result;
    }
  };
}
