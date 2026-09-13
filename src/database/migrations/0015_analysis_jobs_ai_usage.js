// L3-03 adds durable analysis intent and scoped AI admission, preserving history.
export const id = "0015_analysis_jobs_ai_usage";
export async function up(db) {
  const bytes = column => db.kind === "postgres" ? "octet_length(" + column + ")" : "length(CAST(" + column + " AS BLOB))";
  const money = db.kind === "postgres" ? "cost_estimate_microusd ~ '^[0-9]{1,40}$'" : "length(cost_estimate_microusd) BETWEEN 1 AND 40 AND cost_estimate_microusd NOT GLOB '*[^0-9]*'";
  await db.exec(`
    CREATE UNIQUE INDEX idx_analysis_events_workspace_identity ON domain_events(organization_id,id);
    CREATE UNIQUE INDEX idx_ai_receipts_workspace_identity ON webhook_receipts(organization_id,id);
    CREATE TABLE analysis_jobs (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id),
      request_key TEXT NOT NULL CHECK(length(request_key) BETWEEN 1 AND 200),
      request_hash TEXT NOT NULL CHECK(length(request_hash)=64), requested_by TEXT NOT NULL,
      mode TEXT NOT NULL CHECK(mode IN('ANALYSIS_ONLY','PREPARE_DRAFTS')),
      target_stage TEXT NOT NULL CHECK(target_stage IN('SNAPSHOT','SYNTHESIS','RECOMMENDATION','PLAN')),
      execution_scope TEXT NOT NULL CHECK(execution_scope IN('PIPELINE','SINGLE_STAGE')),
      generation_json TEXT NOT NULL CHECK(${bytes("generation_json")} BETWEEN 2 AND 8192),
      simulation_json TEXT CHECK(simulation_json IS NULL OR ${bytes("simulation_json")} BETWEEN 2 AND 1024),
      revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
      command_history_json TEXT NOT NULL DEFAULT '[]' CHECK(${bytes("command_history_json")} BETWEEN 2 AND 65536),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, cancelled_at TEXT,
      cancel_reason TEXT CHECK(cancel_reason IS NULL OR length(cancel_reason)<=2000),
      UNIQUE(organization_id,id), UNIQUE(organization_id,request_key),
      FOREIGN KEY(organization_id,requested_by) REFERENCES users(organization_id,id)
    );
    CREATE TABLE analysis_job_items (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, job_id TEXT NOT NULL,
      lead_id TEXT NOT NULL, event_id TEXT NOT NULL, ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 0 AND 49),
      UNIQUE(organization_id,id), UNIQUE(organization_id,job_id,lead_id),
      UNIQUE(organization_id,event_id), UNIQUE(organization_id,job_id,ordinal),
      FOREIGN KEY(organization_id,job_id) REFERENCES analysis_jobs(organization_id,id),
      FOREIGN KEY(organization_id,lead_id) REFERENCES leads(organization_id,id),
      FOREIGN KEY(organization_id,event_id) REFERENCES domain_events(organization_id,id)
    );
    CREATE INDEX idx_analysis_jobs_history ON analysis_jobs(organization_id,created_at,id);
    CREATE INDEX idx_analysis_items_lead ON analysis_job_items(organization_id,lead_id,job_id);
    CREATE INDEX idx_analysis_items_job ON analysis_job_items(organization_id,job_id,ordinal);
    CREATE TABLE workspace_ai_controls (
      organization_id TEXT PRIMARY KEY REFERENCES organizations(id),
      revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0), paused INTEGER NOT NULL DEFAULT 0 CHECK(paused IN(0,1)),
      max_daily_attempts INTEGER NOT NULL DEFAULT 100 CHECK(max_daily_attempts BETWEEN 1 AND 10000),
      max_in_flight INTEGER NOT NULL DEFAULT 2 CHECK(max_in_flight BETWEEN 1 AND 100),
      pricing_json TEXT NOT NULL DEFAULT '[]' CHECK(${bytes("pricing_json")} BETWEEN 2 AND 32768),
      budget_high_water_at TEXT, updated_by TEXT, updated_at TEXT NOT NULL,
      FOREIGN KEY(organization_id,updated_by) REFERENCES users(organization_id,id)
    );
    CREATE TABLE workspace_ai_control_revisions (
      organization_id TEXT NOT NULL REFERENCES organizations(id), revision INTEGER NOT NULL CHECK(revision>0),
      controls_json TEXT NOT NULL CHECK(${bytes("controls_json")} BETWEEN 2 AND 32768),
      reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 2000), created_by TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY(organization_id,revision),
      FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id)
    );
    CREATE TABLE ai_provider_attempts (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id), lead_id TEXT,
      purpose TEXT NOT NULL CHECK(purpose IN('SYNTHESIS','REPLY_CLASSIFICATION')),
      domain_event_id TEXT, webhook_receipt_id TEXT, origin_fence INTEGER NOT NULL CHECK(origin_fence>=1),
      invocation_key TEXT NOT NULL CHECK(length(invocation_key)=64),
      authorization_hash TEXT NOT NULL CHECK(length(authorization_hash)=64),
      request_fingerprint TEXT NOT NULL CHECK(length(request_fingerprint)=64),
      input_fingerprint TEXT NOT NULL CHECK(length(input_fingerprint)=64),
      pipeline_version TEXT NOT NULL CHECK(length(pipeline_version) BETWEEN 1 AND 128),
      prompt_version TEXT NOT NULL CHECK(length(prompt_version) BETWEEN 1 AND 128),
      schema_version TEXT NOT NULL CHECK(length(schema_version) BETWEEN 1 AND 128),
      provider TEXT NOT NULL CHECK(length(provider) BETWEEN 1 AND 128),
      requested_model TEXT NOT NULL CHECK(length(requested_model) BETWEEN 1 AND 128),
      response_model TEXT CHECK(response_model IS NULL OR length(response_model)<=256),
      provider_response_id TEXT CHECK(provider_response_id IS NULL OR length(provider_response_id)<=256),
      authorized_at TEXT NOT NULL, budget_day TEXT NOT NULL, deadline_at TEXT NOT NULL,
      request_state TEXT NOT NULL CHECK(request_state IN('ADMITTED','OBSERVED','UNCONFIRMED')),
      outcome TEXT CHECK(outcome IS NULL OR outcome IN('COMPLETED','HTTP_REJECTED','INVALID_RESPONSE','TRANSPORT_UNCONFIRMED','TIMEOUT','RECOVERY_UNKNOWN')),
      http_status INTEGER CHECK(http_status IS NULL OR http_status BETWEEN 100 AND 599),
      usage_status TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK(usage_status IN('UNKNOWN','PROVIDER_REPORTED')),
      input_tokens INTEGER CHECK(input_tokens IS NULL OR input_tokens BETWEEN 0 AND 2147483647),
      output_tokens INTEGER CHECK(output_tokens IS NULL OR output_tokens BETWEEN 0 AND 2147483647),
      total_tokens INTEGER CHECK(total_tokens IS NULL OR total_tokens BETWEEN 0 AND 2147483647),
      usage_reason TEXT CHECK(usage_reason IS NULL OR length(usage_reason)<=80),
      elapsed_ms INTEGER CHECK(elapsed_ms IS NULL OR elapsed_ms BETWEEN 0 AND 2147483647),
      pricing_revision INTEGER NOT NULL CHECK(pricing_revision>=0),
      pricing_json TEXT CHECK(pricing_json IS NULL OR ${bytes("pricing_json")} BETWEEN 2 AND 4096),
      cost_status TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK(cost_status IN('UNKNOWN','ESTIMATED')),
      cost_estimate_microusd TEXT CHECK(cost_estimate_microusd IS NULL OR (${money})),
      observation_hash TEXT CHECK(observation_hash IS NULL OR length(observation_hash)=64),
      observed_at TEXT, closed_at TEXT,
      UNIQUE(organization_id,invocation_key), UNIQUE(organization_id,id),
      FOREIGN KEY(organization_id,lead_id) REFERENCES leads(organization_id,id),
      FOREIGN KEY(organization_id,domain_event_id) REFERENCES domain_events(organization_id,id),
      FOREIGN KEY(organization_id,webhook_receipt_id) REFERENCES webhook_receipts(organization_id,id),
      CHECK((purpose='SYNTHESIS' AND domain_event_id IS NOT NULL AND webhook_receipt_id IS NULL AND lead_id IS NOT NULL)
        OR (purpose='REPLY_CLASSIFICATION' AND webhook_receipt_id IS NOT NULL AND domain_event_id IS NULL)),
      CHECK((usage_status='PROVIDER_REPORTED' AND input_tokens IS NOT NULL AND output_tokens IS NOT NULL AND total_tokens IS NOT NULL)
        OR (usage_status='UNKNOWN' AND input_tokens IS NULL AND output_tokens IS NULL AND total_tokens IS NULL)),
      CHECK((cost_status='ESTIMATED' AND cost_estimate_microusd IS NOT NULL) OR (cost_status='UNKNOWN' AND cost_estimate_microusd IS NULL))
    );
    CREATE INDEX idx_ai_attempts_day ON ai_provider_attempts(organization_id,budget_day,authorized_at,id);
    CREATE INDEX idx_ai_attempts_admission ON ai_provider_attempts(organization_id,request_state,deadline_at);
  `);
}
