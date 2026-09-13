// Browser-only disposable fixture. HTTPS is an explicit service-runtime seam, not a TLS/provider acceptance test.
import { generateKeyPairSync } from "node:crypto";
import { startAnalysisJobsFixture } from "./analysisJobsFixture.js";
import { EmailVerificationService } from "../../src/modules/channels/emailVerificationService.js";
import { CHECK_IDS } from "../../src/modules/channels/emailVerificationContract.js";

export async function startEmailVerificationFixture() {
  const fixture = await startAnalysisJobsFixture({ configured: false, automatic: false });
  const publicKey = () => generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({ type: "spki", format: "pem" });
  const controlledRecipients = Object.freeze({ delivery: "controlled-delivery@test.relay.local", failure: "controlled-rejection@test.relay.local" });
  const settings = Object.freeze({ provider: "sendgrid", from_email: "controlled-sender@test.relay.local", reply_to: "reply@parse.test.relay.local",
    api_key: "synthetic-email-verification-key-not-a-credential", sendgrid_events_public_key: publicKey(), sendgrid_inbound_public_key: publicKey() });
  const checkCalls = [], sends = [];
  fixture.services.emailVerificationService = new EmailVerificationService(fixture.db, {
    publicOrigin: "https://synthetic-verification.example.test", controlledRecipients,
    adapter: { async check() {
      checkCalls.push({ number: checkCalls.length + 1 });
      return { version: 1, checks: CHECK_IDS.map(id => ({ id, status: "PASS", code: "SYNTHETIC_CONFIRMED", http_status: 200 })) };
    } }
  });
  // Even an accidental click or a future UI regression cannot reach a channel transport.
  fixture.services.actionExecutor.adapter = { async invoke() {
    sends.push("UNEXPECTED_DISPATCH");
    throw new Error("Verification browser fixture refuses every outbound transport invocation.");
  } };
  return { ...fixture, settings, controlledRecipients, checkCalls, sends,
    async saveSetup(scope, values, request_key) {
      const service = fixture.services.emailConnectionService, state = await service.get(scope);
      return service.save({ ...scope, expected_revision: state.revision, review_token: state.review_token, request_key, reason: "Synthetic fixture configuration change", values });
    },
    async provision(scope) {
      const service = fixture.services.emailConnectionService, state = await service.get(scope);
      return service.provisionRoute({ ...scope, expected_revision: state.revision, review_token: state.review_token, request_key: "synthetic-fixture-route", reason: "Synthetic fixture route" });
    },
    async counts(org) {
      const result = {};
      for (const table of ["email_verification_runs", "email_verification_checks", "email_verification_probes", "email_verification_receipts", "actions", "action_revisions", "action_revision_decisions", "channel_messages", "ai_provider_attempts"]) {
        result[table] = Number((await fixture.db.get("SELECT count(*) n FROM " + table + " WHERE organization_id=?", [org])).n);
      }
      result.action_executions = Number((await fixture.db.get("SELECT count(*) n FROM action_executions x JOIN actions a ON a.id=x.action_id WHERE a.organization_id=?", [org])).n);
      return result;
    }
  };
}
