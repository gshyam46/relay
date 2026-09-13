# Remaining implementation delivery

Recorded2026-09-13 after the user explicitly requested finishing everything. This authorizes continued local implementation of the remaining product and operational capabilities, with documentation and verification in each batch. It does not turn synthetic tests into customer evidence or supply missing provider accounts, recipient authorization, hosting access or business decisions.

## Current scope and order

Continue the modular monolith/PostgreSQL design. Email is the provisional channel; the first deliverable supports one workspace owner. Keep tenant, approval, suppression, idempotency and source-authority controls. No additional channel or discovery dependency is introduced.

1. L4-02 shared composer: real manual/new/reply messages, reviewed edits/scheduling, original-request recovery and the existing exact approval/executor boundary.
2. L4-03 through L4-06: enquiry conversation management, normal reply, follow-up controls, outcomes/export and guided onboarding; integrate one customer journey in React.
3. L4-01 continuation: current-configuration verification evidence, controlled provider checks, correlation and a supported live channel. The existing live hold remains until that contract is implemented and real acceptance is supplied.
4. Parallel L4-07/L5-07: interactive public example, explicit authentication routes, real persisted pilot-interest requests, useful initial HTML and release-quality routing/accessibility/performance.
5. Parallel L5-02: single-owner password/recovery-code/session controls, preserving database authorization. L5-01/L5-03/L5-04: measurable local operational checks and export/retention tooling; external staging/restore/load evidence remains explicit.
6. Finish all feasible automated and local browser checks, documentation, operational runbooks and release-evidence inventory. L5/L6 customer/provider/production facts require actual evidence and cannot be marked complete by implementation alone.

## Batch ownership

Root owns shared API/factory/config/logger, all numbered migrations/registry, package scripts, App/auth route wiring, cross-module integration and shared docs. Backend agent owns composer modules and narrowly approved prepared/approval scheduling edits. Review agent owns auth/account-security modules, races and tests. UI agent owns client/src/marketing, its fixture/verifier and evidence. Dependent contracts are frozen before integrations; completed owners take later bounded tasks.

## L4-02 composer contract

Use existing actions and immutable action_revisions, not a parallel approval system. Add action_composer_commands with scoped action/revision/message/actor foreign keys and unique workspace request keys. Commands store intent/result references, never duplicated mutable message snapshots. Migration0018 adds the ledger and supporting scoped unique indices.

GET /api/leads/:id/composer returns lead/channel, server-derived recipient/sender, capability and contact-policy holds, optional original inbound reply reference, first20 pending EMAIL actions with total/truncation, and a review_token bound to current lead/config/context and the complete bounded pending set. Above1000 pending actions refuse inspection. GET creates no action.

POST that route accepts request_key, review_token, acknowledge_pending, reason, kind:NEW_MESSAGE|REPLY, reply_to_message_id:null|id, subject, body and scheduled_at:null|explicit-offset ISO. Existing pending actions require explicit acknowledgement; changed pending/config/context makes the token stale. An intentional new key creates a distinct message; exact retry returns the original result. REPLY requires a same-workspace/enquiry inbound EMAIL source and is a contextual link until transport threading is implemented. No task is resolved just by drafting.

PUT /api/actions/:id/composer accepts request_key, expected_revision_id, reason, subject, body and scheduled_at. It atomically records a new exact revision, schedule and required approval, refusing in-flight/terminal work. Existing generated/manual/bulk/sequence actions share this editing/review path; edits never create a second send identity. Existing retry/uncertain recovery remains authoritative.

GET /api/composer/requests/:key returns the original command and prepared revision, independently of later action edits or execution. CREATE/EDIT returns {command,prepared_revision,replayed}; inspect current approval separately before approving. Neither draft creation nor editing dispatches an action.

## Public route and request contract

The proposed wholesale /app prefix migration in LANDING_PAGE is narrowed to preserve existing protected deep links. / is public and independent of session/API availability; /app is the protected dashboard; existing /leads, /intelligence, /outbound, /conversations, /settings and other protected routes retain their meanings. /login and /register are explicit routes over the existing cookie/auth contract. Registration creates the existing Sandbox workspace; it grants no live provider verification. Safe same-origin return paths preserve expired-session destinations.

The marketing example uses synthetic deterministic fixtures and no domain/provider writes. Public/protected chunks load separately. Initial public HTML contains useful identity/headline/links; private/auth requests receive a noindex application document. Root controls static serving and metadata; there is no new framework or server-rendering infrastructure.

POST /api/public/pilot-requests accepts exactly request_key,name,email,company,workflow,channel:EMAIL|WHATSAPP|UNDECIDED,consent:true,website:'' (honeypot). Limits: request key/name/company200, email254, workflow2000; bounded body and durable peer/global admission. Return202 {accepted:true}, with finite400/429/503 errors. Repeated request identity is idempotent. Interest is stored separately from customer leads; no email notification or accepted pilot is implied. Operational triage is a deliberate local database CLI, not a cross-tenant owner endpoint. UI success says the request is saved for review. Deletion/retention and an accountable response owner are required before publication.

## Acceptance

Meaningful behavior tests cover scoped rollback/races/replay, real existing approval/retry safety, origin/access and abuse bounds, account/session revocation, public route isolation and complete browser journeys. Keep existing tests unless changed contracts require a stronger equivalent. Verify migrations on disposable SQLite and explicitly gated PostgreSQL; do not count skips as passes. Use safe launchers; no inherited environment providers or customer DB. Each implementation task stays in progress where required human/provider acceptance remains missing.

## Integrated completion status

The planned local slices are now implemented and integrated. [COMPLETION](verification/COMPLETION.md) records the final safe suite, actual browser candidate and measured workload; [RELEASE_ACCEPTANCE](RELEASE_ACCEPTANCE.md) provides the concrete remaining gate sequence and decision templates. Integration additionally corrected contact-free capture, outcome-driven dashboard counts, mobile/focus behavior, cross-owner query caches and stale signed ingress after configuration changes or erasure. Manual capture holds an unknown response for directory inspection; durable request-key recovery remains specific to the documented command APIs. Parent tasks remain [~] until required live/human evidence is supplied.
