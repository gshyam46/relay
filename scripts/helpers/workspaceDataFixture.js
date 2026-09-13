import { startAnalysisJobsFixture } from "./analysisJobsFixture.js";

export async function startWorkspaceDataFixture() {
  return startAnalysisJobsFixture({ configured: false, automatic: false });
}
