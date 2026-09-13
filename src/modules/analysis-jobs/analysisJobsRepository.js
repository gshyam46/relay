import { publicItem, publicJob, analysisError } from "./analysisJobsContract.js";
export class AnalysisJobsRepository {
  constructor(db) { this.db = db; }
  row(org, id) { return this.db.get("SELECT * FROM analysis_jobs WHERE organization_id=? AND id=?", [org, id]); }
  byKey(org, key) { return this.db.get("SELECT * FROM analysis_jobs WHERE organization_id=? AND request_key=?", [org, key]); }
  async detail(org, id, now) {
    const row = await this.db.get("SELECT id,organization_id,request_key,revision,mode,target_stage,requested_by,created_at,updated_at,cancelled_at FROM analysis_jobs WHERE organization_id=? AND id=?", [org, id]);
    if (!row) throw analysisError("ANALYSIS_JOB_NOT_FOUND", "Analysis job not found.", 404);
    const items = await this.items(org, id), views = [];
    for (const item of items) {
      const stages = await this.db.all("SELECT stage_key,status,artifact_type,artifact_id FROM domain_event_stages WHERE organization_id=? AND event_id=? ORDER BY prepared_at,id LIMIT 17", [org, item.event_id]);
      if (stages.length > 16) throw analysisError("ANALYSIS_JOB_INVALID", "Analysis progress exceeds its supported bound.", 409);
      views.push(publicItem(item, stages, now));
    }
    return publicJob(row, views, now);
  }
  async items(org, id) {
    const rows = await this.db.all("SELECT i.id,i.lead_id,i.event_id,i.ordinal,substr(l.name,1,200) AS lead_name,e.status,e.attempts,e.max_attempts,e.processing_version,e.processing_fence,e.first_processing_at,e.retry_deadline_at,e.next_attempt_at,e.processing_hold_reason,e.last_error_code,e.updated_at AS event_updated_at FROM analysis_job_items i JOIN leads l ON l.organization_id=i.organization_id AND l.id=i.lead_id JOIN domain_events e ON e.organization_id=i.organization_id AND e.id=i.event_id WHERE i.organization_id=? AND i.job_id=? ORDER BY i.ordinal LIMIT 51", [org, id]);
    if (rows.length > 50) throw analysisError("ANALYSIS_JOB_INVALID", "Analysis selection exceeds its supported bound.", 409);
    return rows;
  }
  async unfinished(org) {
    return Number((await this.db.get("SELECT count(*) AS n FROM analysis_job_items i JOIN domain_events e ON e.organization_id=i.organization_id AND e.id=i.event_id WHERE i.organization_id=? AND e.status NOT IN ('PROCESSED','DISMISSED')", [org])).n);
  }
  async insertJob(row) {
    const fields = ["id", "organization_id", "request_key", "request_hash", "requested_by", "mode", "target_stage", "execution_scope", "generation_json", "simulation_json", "revision", "command_history_json", "created_at", "updated_at", "cancelled_at", "cancel_reason"];
    await this.db.run("INSERT INTO analysis_jobs (" + fields.join(",") + ") VALUES (" + fields.map(() => "?").join(",") + ")", fields.map(field => row[field]));
  }
  async insertItem(row) { await this.db.run("INSERT INTO analysis_job_items (id,organization_id,job_id,lead_id,event_id,ordinal) VALUES (?,?,?,?,?,?)", [row.id, row.organization_id, row.job_id, row.lead_id, row.event_id, row.ordinal]); }
}
