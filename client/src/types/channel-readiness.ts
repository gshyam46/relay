export interface EmailConnectionValues {
  provider: string;
  from_email: string;
  reply_to: string;
  api_key: string;
  sendgrid_events_public_key: string;
  sendgrid_inbound_public_key: string;
}
export interface EmailConnectionSnapshot {
  revision: number;
  management: "LEGACY" | "MANAGED" | "DRIFTED";
  settings: EmailConnectionValues & { api_key_configured: boolean };
  configuration: { complete: boolean; missing_fields: string[]; invalid_fields: string[] };
  verification: { status: "UNVERIFIED" | "VERIFIED"; checks: { id: string; label: string; status: "UNVERIFIED" | "VERIFIED" }[] };
  routing: { provisioned: boolean; inbound_url: string | null; events_url: string | null; generated_alias_count: number; legacy_route_present: boolean };
}
export interface EmailConnectionChange {
  id: string;
  revision: number;
  operation: "SAVE" | "PROVISION_ROUTE" | "ROTATE_ROUTE";
  before: EmailConnectionSnapshot;
  after: EmailConnectionSnapshot;
  reason: string;
  created_at: string;
  created_by: string;
}
export interface EmailConnectionHistory {
  changes: EmailConnectionChange[];
  has_more: boolean;
  next_before_revision: number | null;
}
export interface EmailConnectionState extends EmailConnectionSnapshot {
  live_send_available: boolean;
  review_token: string | null;
  can_save: boolean;
  can_provision: boolean;
  can_rotate: boolean;
  hold_reasons: string[];
  history: EmailConnectionHistory;
}
export interface EmailConnectionCommand {
  expected_revision: number;
  review_token: string;
  request_key: string;
  reason: string;
  values?: EmailConnectionValues;
}
export type EmailConnectionOperation = EmailConnectionChange["operation"];
