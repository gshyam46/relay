# Domain Model

## Purpose

Define the core business concepts and contracts for AI Lead Intelligence & Outbound Automation.

The domain is divided conceptually into:

```text
DATA FOUNDATION
        ↓
LEAD INTELLIGENCE
        ↓
OUTBOUND AUTOMATION
        ↓
EVENTS
        ↓
UPDATED LEAD INTELLIGENCE
```

---

# Data Foundation

## Organization

Customer/tenant.

Key concepts:

- id
- name
- settings
- created_at

All tenant-owned records belong to an organization.

## User

User belonging to an organization.

## Lead

A lead/prospect/customer record that can be understood and acted upon.

A lead may originate from:

- CSV
- Google Sheets
- CRM
- website
- form
- manual input
- customer database
- discovery plugin
- external provider

## Person

Human identity associated with a lead/company.

## Company

Business/entity associated with a lead.

## LeadSource

Describes where a lead originated.

Examples:

```text
CSV
GOOGLE_SHEETS
CRM
WEBSITE
MANUAL
DISCOVERY
EXTERNAL_PROVIDER
```

## IngestionAdapter

Adapter that converts a customer-owned source into normalized ingestion rows.

M1 implements only:

```text
CSV
```

Future adapters may include Google Sheets, CRM, website forms, directories, and other customer-owned systems. Those adapters should produce the same normalized ingestion-row contract before entering Lead Data Foundation.

## ImportBatch

Represents one source import attempt.

Key concepts:

- id
- organization_id
- filename
- adapter_type
- source metadata
- state
- idempotency key
- summary counts
- timestamps

States:

```text
UPLOADED
PREVIEWED
READY_TO_COMMIT
COMMITTING
COMMITTED
FAILED
```

## ImportRow

Represents one source row before it becomes a lead.

Key concepts:

- import_id
- row number
- raw row data
- mapped values
- normalized values
- validation state
- selected state
- committed state
- created lead id
- duplicate candidate metadata

Raw source data is preserved in the import row so the lead can reference provenance without duplicating every raw field.

## ImportIssue

Represents a validation, parsing, or duplicate-candidate issue for an import row or batch.

Key concepts:

- import row
- issue type
- field
- message
- severity
- metadata

## DuplicateCandidate

M1 identifies duplicate candidates only.

Rules:

```text
normalized email match -> STRONG_EMAIL
normalized phone match -> STRONG_PHONE
normalized name + company match -> POSSIBLE_NAME_COMPANY
```

Duplicate candidates may match an existing lead or another preview row. M1 does not automatically merge, skip, delete, or resolve identities.

## LeadProvenance

Imported leads store enough provenance to answer:

```text
Where did this lead come from?
Which import produced this lead?
```

M1 stores source, import batch id, import row id, normalized contact fields, and source metadata on the lead. The authoritative raw row remains on the import row.

---

# Lead Intelligence

M2.0 defines the AI Lead Intelligence foundation. It produces deterministic, persisted intelligence from current Lead Data Foundation data only. External research, enrichment, LLM synthesis, discovery, and real provider integrations are deferred.

The core M2.0 flow is:

```text
Lead
  -> Evidence
  -> Claims
  -> Signals
  -> Data Readiness
  -> Qualification Foundation
  -> Recommended Next Step
  -> Intelligence Snapshot
```

## Enrichment

Additional information obtained about a lead/person/company.

## Research

Structured research about a lead, person, company, opportunity, or relevant context.

Research should distinguish between:

- facts
- sources/evidence
- inference
- confidence

## Signal

A meaningful piece of information relevant to lead intelligence.

M2.0 deterministic examples:

- contact information available
- company provided
- company missing
- email available
- phone available
- duplicate warning
- data incomplete
- provenance available

Future signals may include recent enquiry, projects, hiring, product interest, location, business expansion, previous interaction, or stated budget when actual evidence exists and the product explicitly adds those fields.

## Qualification

Assessment of whether/how strongly a lead matches defined criteria.

M2.0 supports a qualification foundation only. It distinguishes whether the stored data foundation is usable for future intelligence. It does not claim market fit, buying intent, business priority, or conversion likelihood.

## Score

Normalized assessment of lead relevance/priority.

Scoring must be explainable enough to understand the major contributing factors.

In M2.0 the implemented numeric value is `readiness_score`. It is a deterministic data-quality/readiness score, not an AI lead qualification score.

## Segment

Logical grouping of leads.

Examples:

- dormant enquiries
- high-priority leads
- repeat customers
- high-value prospects

## IntelligenceSnapshot

A point-in-time representation of the system's understanding of a lead.

May contain:

- profile summary
- research
- signals
- qualification
- score
- segment
- personalization information
- confidence
- evidence

M2.0 snapshots are versioned and use lifecycle states:

```text
DRAFT
READY
FAILED
SUPERSEDED
```

The same lead data version and pipeline version is idempotent. Re-running intelligence for unchanged lead data returns the existing ready snapshot. Failed generation records the failed state and can be retried without creating uncontrolled duplicate child records. Changing lead data creates a new version and preserves earlier snapshots.

## Evidence

An evidence record explains where a stored fact came from.

Key concepts:

- id
- organization_id
- lead_id
- snapshot_id
- source type
- source reference
- source URL where applicable
- title
- raw/source content reference
- extracted claim field/value
- evidence timestamp
- retrieved timestamp where applicable
- confidence
- metadata

M2.0 implements evidence from existing lead data:

```text
MANUAL
CSV
CUSTOMER_PROVIDED
```

Future source types such as website, registry, directory, search, CRM, or enrichment provider must enter the intelligence domain as evidence. They must not directly mutate snapshots.

## ResearchEvidenceAdapter

M2.1 introduces the adapter boundary for approved research/evidence sources.

The current implementation includes only an approved local/manual adapter for contract validation. It does not perform web research, scraping, search, enrichment, LLM synthesis, discovery, or external provider calls.

The adapter produces normalized research evidence:

- source type
- source reference
- source URL where applicable
- title
- raw/source content reference
- claim field
- claim value
- evidence timestamp
- retrieved timestamp
- confidence metadata
- provider metadata

Adapters write to evidence staging, not directly to intelligence snapshots.

## ResearchEvidenceIngestion

Represents one approved evidence ingestion attempt.

States:

```text
RECEIVED
VALIDATED
PERSISTED
FAILED
```

Ingestion is idempotent by key. Repeating a persisted ingestion returns the same persisted evidence. A failed ingestion can be retried safely.

## SynthesisAgent

M2.2 introduces a structured synthesis and qualification contract for the Lead Intelligence domain.

The current implementation uses a local deterministic agent to produce the same shape expected from a future LLM provider. It does not call an LLM, perform research, enrich data, discover leads, execute outbound actions, or invent unsupported facts.

Inputs:

- current ready intelligence snapshot
- snapshot evidence, claims, signals, qualification, and recommendation
- staged research evidence from approved M2.1 adapters

Outputs:

- summary
- evidence-grounded findings
- qualification outcome and reasons
- synthesis recommendation
- evidence references

Every finding, qualification reason, and recommendation must be grounded in persisted evidence references.

## SynthesisRun

Represents one persisted M2.2 synthesis attempt.

Key concepts:

- id
- organization_id
- lead_id
- snapshot_id
- version
- status
- pipeline version
- input fingerprint
- structured summary
- structured findings
- structured qualification
- structured recommendation
- evidence references
- failure reason
- timestamps

States:

```text
DRAFT
READY
SUPERSEDED
FAILED
```

The same current snapshot, staged evidence, and synthesis pipeline version are idempotent. Repeating synthesis for unchanged evidence returns the same ready run. Adding new staged evidence creates a new synthesis version and preserves the prior run as superseded.

## RecommendationIntelligence

M2.3 introduces recommendation intelligence inside the Lead Intelligence domain. It is not the M3 action planner and it does not create executable actions.

Inputs:

- current ready synthesis run
- current ready intelligence snapshot
- evidence-backed qualification outcome
- readiness and duplicate signals

Outputs:

- attention priority
- segment
- personalization context
- recommended next step
- evidence references

M2.3 supported segments:

```text
NEEDS_DATA
DUPLICATE_CANDIDATE
NEEDS_INTELLIGENCE_REVIEW
READY_FOR_OUTBOUND_REVIEW
```

M2.3 supported recommended steps:

```text
GATHER_MORE_DATA
REVIEW_DUPLICATE_CANDIDATE
REVIEW_LEAD_INTELLIGENCE
PREPARE_OUTBOUND_REVIEW
```

These recommended steps are intelligence guidance only. M3 will decide how to convert guidance into an action plan with policy and approval.

## RecommendationRun

Represents one persisted M2.3 recommendation intelligence attempt.

Key concepts:

- id
- organization_id
- lead_id
- synthesis_id
- snapshot_id
- version
- status
- pipeline version
- input fingerprint
- priority
- segment
- personalization context
- recommendation
- evidence references
- failure reason
- timestamps

States:

```text
DRAFT
READY
SUPERSEDED
FAILED
```

The same current synthesis and recommendation pipeline version are idempotent. Repeating recommendation generation for unchanged synthesis returns the same ready run. A new synthesis creates a new recommendation version and preserves the prior run as superseded.

## NextBestActionPlan

M3 introduces a persisted next-best-action plan between Lead Intelligence and Outbound Automation.

Inputs:

- current ready recommendation intelligence
- lead lifecycle/contact state
- evidence references from recommendation intelligence
- policy rules

Outputs:

- action type
- title
- rationale
- policy decision
- approval requirement
- decision evidence references
- execution contract

States:

```text
DRAFT
PLANNED
BLOCKED
SUPERSEDED
FAILED
```

Supported M3 plan types:

```text
GATHER_MORE_DATA
REVIEW_DUPLICATE_CANDIDATE
REVIEW_LEAD_INTELLIGENCE
PREPARE_OUTBOUND_REVIEW
```

M3 plans are not executable outbound actions. They do not create `ActionExecution`, call n8n, send messages, or bypass approval. The execution contract is persisted as non-executable until later outbound and approval milestones convert approved plans into executable work.

## PolicyDecision

M3 policy decisions are:

```text
ALLOW
REQUIRE_HUMAN_APPROVAL
BLOCK
```

Opted-out or suppressed leads are blocked. Outbound review preparation requires usable contact information and human approval. Duplicate candidates and intelligence review steps require human review before any future execution milestone.

## Claim

A claim is a structured statement the system can support with evidence.

Key concepts:

- id
- organization_id
- lead_id
- snapshot_id
- field
- value
- confidence
- evidence references
- created timestamp

M2.0 claim fields include lead name, company name, contact email, contact phone, lead source, and provenance. New claim types can be added without redesigning the database for each individual attribute because claim `field` is structured and claim `value` is serialized.

This is deliberately not a free-form text blob: the field, confidence, lead, snapshot, and evidence links remain structured.

## Confidence

M2.0 supports:

```text
LOW
MEDIUM
HIGH
```

Confidence is attached to evidence, claims, signals, and recommendations as internal processing metadata where appropriate. Customer-facing M2.0 UI should describe ordinary lead fields as customer-provided data, not externally verified facts. Unsupported assertions must not appear as facts.

## IntelligenceStatus

Intelligence status is separate from lead lifecycle state and data readiness.

Implemented M2.0 statuses:

```text
NOT_RUN
READY_TO_RUN
GENERATED
NEEDS_DATA
FAILED
```

A lead can be `NEW`, have data readiness `READY`, and still have intelligence status `NOT_RUN` until a snapshot is generated.

## Data Readiness

Data readiness is deterministic and based on stored customer-owned lead data.

M2.0 considers:

- has name
- has company
- has email
- has phone
- has normalized email
- has normalized phone
- has source
- has provenance
- has enough identity and contact information
- duplicate warning exists
- important fields missing

Readiness states:

```text
READY_FOR_INTELLIGENCE
NEEDS_MORE_DATA
```

## Personalization

Useful context used to tailor an outbound action.

Personalization should be based on available evidence rather than invented claims.

## NextBestAction

Recommendation for what should happen next.

Examples:

```text
SEND_WHATSAPP
SEND_EMAIL
CREATE_HUMAN_TASK
RUN_RESEARCH
WAIT
UPDATE_CRM
```

The recommendation is not itself the execution.

In M2.0 this boundary is represented as an intelligence recommendation, with a separate outbound action type for compatibility with the existing action system. The intelligence layer may recommend gather more data, review the lead, or mark the lead ready for recommendation review. Email or phone presence alone is treated as a data signal, not a reason to claim an outbound contact recommendation. Outbound automation remains responsible for execution.

---

# Outbound Automation

## Campaign

A business objective involving leads and automated actions.

Implemented M6 foundation concepts:

- organization_id
- name
- objective
- status
- timestamps

Campaign status:

```text
DRAFT
ACTIVE
PAUSED
ARCHIVED
```

## Sequence

Ordered collection of outbound/operational steps.

Sequences belong to campaigns and are organization scoped.

Sequence status:

```text
DRAFT
ACTIVE
PAUSED
ARCHIVED
```

## SequenceStep

Individual step within a sequence.

Examples:

- send message
- wait
- create human task
- research
- branch on response
- update CRM

M6 foundation step concepts:

- step order
- type
- channel
- title/body
- delay hours
- approval requirement
- stop-on-reply flag
- payload metadata

Steps create normal `Action` records when due. They do not bypass approval, policy, handlers, retries, or channel messages.

## Action

Represents an intended operation.

Examples:

```text
SEND_WHATSAPP
SEND_EMAIL
CREATE_HUMAN_TASK
UPDATE_CRM
RUN_RESEARCH
WAIT
```

M4 actions may be created from a persisted M3 `NextBestActionPlan`. The action keeps the plan link, approval requirement, execution mode, provider, payload, idempotency key, status, and last error. The plan remains the decision record; the action is the operational record.

Approval-required actions must have an `ActionApproval` before they can proceed.

## ActionExecution

Represents an actual attempt to execute an action.

Contains concepts such as:

- attempt count
- status
- timestamps
- provider reference
- error
- idempotency key

M4 execution statuses are:

```text
STARTED
COMPLETED
FAILED
```

Execution attempts are idempotent by execution key. Repeated execution requests for an in-progress or terminal action return existing state instead of creating duplicate attempts.

## ExecutionCallback

Represents a provider or sandbox callback for an action execution.

Key concepts:

- organization_id
- lead_id
- action_id
- action_execution_id
- provider_event_id
- status
- provider reference
- payload
- received timestamp

Provider event ids are idempotent. Repeated callbacks do not duplicate side effects.

## Conversation

Logical interaction with a lead.

## Message

Individual inbound/outbound communication.

## Channel

Normalized communication or operational channel.

Current vocabulary:

```text
EMAIL
WHATSAPP
SMS
VOICE
HUMAN_TASK
CRM
```

M6/M7 foundation implements email and WhatsApp as mock channel paths through the existing sandbox execution boundary. Voice, SMS, and CRM are contract paths only until real providers are intentionally added.

## ChannelMessage

Application-owned record of inbound or outbound channel activity.

Key concepts:

- organization_id
- lead_id
- action_id where outbound activity came from an action
- inbound_event_id where inbound activity came from a provider event
- direction: `OUTBOUND` or `INBOUND`
- channel
- normalized status
- provider and provider reference
- provider event id where applicable
- idempotency key
- payload
- occurred timestamp

Channel messages are not provider logs. They are the product's normalized communication/activity record.

## InboundEvent

Normalized incoming provider/customer event.

Implemented M6/M7 foundation event types:

```text
POSITIVE_REPLY
NEGATIVE_REPLY
QUESTION
OPT_OUT
UNKNOWN
```

Inbound events are idempotent by organization, provider, and provider event id. M6/M7 implements mock inbound intake only; real webhook verification and provider-specific mapping remain later hardening/provider work.

## FollowUpTask

Persisted follow-up state owned by the application.

Implemented statuses:

```text
PLANNED
DUE
COMPLETED
CANCELLED
BLOCKED
```

Current behavior:

- completed sandbox email/WhatsApp outbound activity creates one planned no-response follow-up.
- inbound questions and unknown responses create due human-review follow-ups.
- positive, negative, and opt-out responses stop open follow-ups.
- opt-out responses update lead status to `OPTED_OUT`.

## Approval

Human review of a proposed action.

States:

```text
PENDING
APPROVED
REJECTED
EDITED
EXPIRED
```

M5 implements approval as `ActionApproval`.

Key concepts:

- organization_id
- lead_id
- action_id
- status
- requested reason
- reviewer name
- reviewer note
- edited payload
- decision timestamp

Implemented M5 statuses:

```text
PENDING
APPROVED
REJECTED
```

Approving an action moves the action to `APPROVED`. Edit-and-approve stores reviewer edits with the action payload. Rejecting an action moves the action to `BLOCKED`. Repeating the same terminal approval decision is idempotent; reversing a rejected or approved decision is not allowed in M5.

## WorkflowRun

Execution instance of a sequence/workflow.

M6 foundation workflow run states:

```text
ACTIVE
WAITING
WAITING_APPROVAL
COMPLETED
STOPPED
BLOCKED
```

Workflow runs are idempotent by organization, sequence, and lead. A workflow run tracks the current step, next due time, last action, and stop reason. Positive, negative, and opt-out inbound events stop open workflow runs for the lead.

---

# Discovery

## LeadCandidate

A normalized candidate produced by a discovery source.

Conceptual structure:

```json
{
  "source": "provider",
  "name": "",
  "company": "",
  "phone": "",
  "email": "",
  "website": "",
  "location": "",
  "source_url": "",
  "confidence": 0.0,
  "raw_reference": ""
}
```

Discovery candidates enter the normal Lead Intelligence pipeline.

The core domain must not depend on provider-specific discovery fields.

---

# Lead Lifecycle

Initial lifecycle:

```text
NEW
 ↓
NORMALIZED
 ↓
ENRICHING
 ↓
RESEARCHING
 ↓
INTELLIGENCE_READY
 ↓
QUALIFIED
 ↓
ACTIVE
 ↓
CONVERTED
```

Exceptional states:

```text
FAILED
SUPPRESSED
OPTED_OUT
```

Exact states may evolve, but transitions must remain explicit.

---

# Action Lifecycle

```text
PLANNED
 ↓
AWAITING_APPROVAL
 ↓
APPROVED
 ↓
EXECUTING
 ↓
COMPLETED
```

Failure:

```text
EXECUTING
 ↓
FAILED
 ↓
RETRYING
 ↓
EXECUTING
```

Non-retryable:

```text
FAILED
 ↓
BLOCKED
```

---

# Message Lifecycle

Potential states:

```text
DRAFT
PENDING_APPROVAL
APPROVED
QUEUED
SENT
DELIVERED
FAILED
RECEIVED
```

Provider-specific states should be normalized internally.

---

# Domain Rules

1. Tenant-owned data belongs to an organization.
2. Opted-out leads cannot be contacted.
3. Actions must pass policy before execution.
4. External side effects must be idempotent.
5. AI recommendations do not bypass policy.
6. Important state transitions are auditable.
7. Provider-specific data must be normalized before entering core domain logic.
8. Discovery is optional.
9. Lead Intelligence remains independent from outbound execution.
10. Outbound actions should reference the relevant intelligence/context that caused the recommendation.
11. Human approval is represented explicitly when required.
12. Events should allow important outbound results to feed back into Lead Intelligence.
13. Imported leads do not require a person name if the row has company + email, company + phone, name + email, or name + phone.
14. Company-only imported rows are not accepted in M1 because the current domain does not yet permit company-only leads.
15. Import commit must be idempotent; a committed import row must not create more than one lead.
16. M2.2 synthesis must be grounded in persisted evidence references and must not create outbound side effects.
17. M2.3 recommendation intelligence must not create outbound actions or bypass future policy/approval.
18. M3 next-best-action planning must persist policy and approval decisions before any outbound execution milestone can act.
19. M3 next-best-action plans are not executable actions.
20. M4 actions created from plans must be idempotent by plan id.
21. Approval-required actions must not execute before approval.
22. M4 sandbox callbacks must update persisted action and execution state idempotently.
23. M5 approval decisions must be organization scoped, persisted, and auditable.
24. Channel messages must normalize inbound and outbound activity without leaking provider-specific behavior into Lead Intelligence.
25. Inbound provider events must be idempotent and organization scoped.
26. Follow-up state must be persisted in the application database, not inferred only from frontend state or provider logs.
27. Sequence enrollment must be idempotent by organization, sequence, and lead.
28. Sequence steps must create normal outbound actions instead of bypassing approval, handler, retry, or channel boundaries.
29. Inbound replies that satisfy stop conditions must stop open workflow runs before additional follow-up steps are prepared.
