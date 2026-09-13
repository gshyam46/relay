// Owned disposable setup fixture. No workers, model adapter, provider probe or live write endpoint.
import { generateKeyPairSync } from "node:crypto";
import { startAnalysisJobsFixture } from "./analysisJobsFixture.js";
import { SettingsRepository } from "../../src/modules/settings/settingsRepository.js";

export async function startChannelSetupFixture() {
  const fixture = await startAnalysisJobsFixture({ configured: false, automatic: false });
  const settings = new SettingsRepository(fixture.db);
  const publicKey = () => generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({ type: "spki", format: "pem" }).trim();
  const keys = { events: publicKey(), inbound: publicKey() };
  return {
    ...fixture, keys,
    async seedEmail(organizationId, values) { await settings.setBulk(organizationId, "channel_email", values); },
    async seedUnsupported(organizationId) {
      await settings.setBulk(organizationId, "channel_whatsapp", { provider: "meta", api_key: "synthetic-retained-access-token" });
      await settings.setBulk(organizationId, "channel_telegram", { provider: "telegram_bot", bot_token: "synthetic-retained-bot-token" });
    },
    async secret(organizationId) { return settings.get(organizationId, "channel_email", "api_key"); },
    async counts(organizationId) {
      const changes = await fixture.db.get("SELECT COUNT(*) AS count FROM email_connection_revisions WHERE organization_id=?", [organizationId]);
      const routes = await fixture.db.get("SELECT COUNT(*) AS count FROM email_webhook_routes WHERE organization_id=?", [organizationId]);
      return { changes: Number(changes.count), routes: Number(routes.count), model_calls: fixture.calls.length };
    }
  };
}
