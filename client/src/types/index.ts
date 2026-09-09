export interface Organization {
  id: string;
  name: string;
  created_at: string;
}

export interface Lead {
  id: string;
  organization_id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  source: string;
  status: string;
  normalized_email: string | null;
  normalized_phone: string | null;
  import_batch_id: string | null;
  import_row_id: string | null;
  source_metadata?: { filename?: string; row_number?: number; [key: string]: unknown } | null;
  created_at: string;
  updated_at: string;
}

export interface ImportBatch {
  id: string;
  organization_id: string;
  filename: string;
  adapter_type: string;
  state: string;
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  committed_rows: number;
  created_at: string;
}

export interface IntelligenceSnapshot {
  id: string;
  organization_id: string;
  lead_id: string;
  version: number;
  status: string;
  readiness_status: string;
  readiness_score: number;
  created_at: string;
}

export interface SynthesisRun {
  id: string;
  organization_id: string;
  lead_id: string;
  status: string;
  summary: string | null;
  findings: string | null;
  qualification: string | null;
  recommendation: string | null;
  created_at: string;
}

export interface NextBestActionPlan {
  id: string;
  organization_id: string;
  lead_id: string;
  action_type: string;
  title: string;
  rationale: string;
  policy_decision: string;
  approval_requirement: string;
  status: string;
  created_at: string;
}

export interface Action {
  id: string;
  organization_id: string;
  lead_id: string;
  type: string;
  status: string;
  approval_requirement: string;
  created_at: string;
}

export interface Approval {
  id: string;
  organization_id: string;
  action_id: string;
  status: string;
  reviewer_name: string | null;
  reviewer_note: string | null;
  created_at: string;
}

export interface FollowUp {
  id: string;
  organization_id: string;
  lead_id: string;
  type: string;
  status: string;
  reason: string;
  due_at: string | null;
  created_at: string;
}

export interface ChannelMessage {
  id: string;
  organization_id: string;
  lead_id: string;
  direction: "INBOUND" | "OUTBOUND";
  channel: string;
  status: string;
  payload: string | null;
  occurred_at: string;
}

export interface Campaign {
  id: string;
  organization_id: string;
  name: string;
  objective: string | null;
  status: string;
  created_at: string;
}

export interface WorkflowRun {
  id: string;
  organization_id: string;
  sequence_id: string;
  lead_id: string;
  status: string;
  current_step: number;
  created_at: string;
}

export interface DashboardMetrics {
  totalLeads: number;
  activeLeads: number;
  intelligenceReady: number;
  pendingReview: number;
  followUpsDue: number;
}

export interface PipelineStage {
  stage: string;
  count: number;
  label: string;
}
