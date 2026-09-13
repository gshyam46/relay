// Explicit synthetic setup; the compatibility GET remains read-only.
export async function provisionEmailWebhooks(client, organizationId) {
  const connection = await client.get("/api/settings/channels/email/connection?organization_id=" + organizationId);
  if (!connection.routing.provisioned) await client.post("/api/settings/channels/email/connection/provision", {
    organization_id: organizationId, expected_revision: connection.revision, review_token: connection.review_token,
    request_key: "test-route:" + organizationId, reason: "Provision the isolated synthetic webhook fixture."
  });
  return client.get("/api/settings/channels/email/webhooks?organization_id=" + organizationId);
}
