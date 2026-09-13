// Reuse the owned isolated server boundary; this slice never starts its analysis pump.
import { startAnalysisJobsFixture } from "./analysisJobsFixture.js";
export async function startIntelligenceFeedbackFixture() {
  return startAnalysisJobsFixture({ configured: false, automatic: false });
}
