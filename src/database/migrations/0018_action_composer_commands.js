export const id="0018_action_composer_commands";
export async function up(db){await db.exec(`
 CREATE UNIQUE INDEX idx_composer_action_scope ON actions(organization_id,lead_id,id);
 CREATE UNIQUE INDEX idx_composer_revision_scope ON action_revisions(organization_id,action_id,id);
 CREATE TABLE action_composer_commands(
  id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,lead_id TEXT NOT NULL,action_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN('CREATE','EDIT')),
  request_key TEXT NOT NULL CHECK(length(request_key) BETWEEN 1 AND 200),request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
  expected_revision_id TEXT,resulting_revision_id TEXT NOT NULL,
  message_kind TEXT NOT NULL CHECK(message_kind IN('NEW_MESSAGE','REPLY')),reply_to_message_id TEXT,
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 2000),created_at TEXT NOT NULL,created_by TEXT NOT NULL,
  CHECK((operation='CREATE' AND expected_revision_id IS NULL) OR(operation='EDIT' AND expected_revision_id IS NOT NULL)),
  CHECK((message_kind='NEW_MESSAGE' AND reply_to_message_id IS NULL) OR(message_kind='REPLY' AND reply_to_message_id IS NOT NULL)),
  UNIQUE(organization_id,request_key),UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,lead_id) REFERENCES leads(organization_id,id),
  FOREIGN KEY(organization_id,lead_id,action_id) REFERENCES actions(organization_id,lead_id,id),
  FOREIGN KEY(organization_id,action_id,expected_revision_id) REFERENCES action_revisions(organization_id,action_id,id),
  FOREIGN KEY(organization_id,action_id,resulting_revision_id) REFERENCES action_revisions(organization_id,action_id,id),
  FOREIGN KEY(organization_id,lead_id,reply_to_message_id) REFERENCES channel_messages(organization_id,lead_id,id),
  FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id)
 );
 CREATE INDEX idx_composer_command_history ON action_composer_commands(organization_id,action_id,created_at,id);
`);}
