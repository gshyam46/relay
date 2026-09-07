# Product

## Product Identity

# AI Lead Intelligence & Outbound Automation

## Vision

Build a modular SaaS platform that transforms fragmented, incomplete, and continuously changing lead data into useful intelligence and then automates appropriate outbound actions based on that intelligence.

The product has two primary pillars:

### 1. AI Lead Intelligence

Understand leads and determine:

* who they are
* what is known
* what is missing
* how relevant they are
* what signals exist
* what they may need
* how valuable/relevant they are
* which segment they belong to
* what should happen next

### 2. Outbound Automation

Use that intelligence to:

* determine appropriate outbound actions
* generate communications
* schedule actions
* execute actions
* follow up
* process responses
* update lead state
* trigger the next appropriate action

## Core Product Loop

```text
Lead Sources
    ↓
Lead Ingestion
    ↓
Normalization
    ↓
Identity Resolution / Deduplication
    ↓
Enrichment
    ↓
Research
    ↓
Signal Extraction
    ↓
Qualification
    ↓
Scoring
    ↓
Segmentation
    ↓
Personalization
    ↓
Next Best Action
    ↓
Policy
    ↓
Outbound Automation
    ↓
Response / Event
    ↓
Lead Intelligence Update
    ↓
Next Best Action
```

## Lead Intelligence

Lead Intelligence is the central product capability.

It should work with incomplete and messy data.

It should combine:

* customer-provided information
* historical interactions
* structured lead attributes
* enrichment
* research
* behavioral/events data
* AI-generated analysis
* external information where appropriate

The system should distinguish between:

* known facts
* externally sourced information
* inferred information
* AI interpretation
* confidence

## AI Lead Intelligence Foundation

M2.0 establishes the foundation for AI Lead Intelligence.

It answers from current customer-owned data:

* what data is available
* where it came from
* which claims can be supported
* which fields were customer-provided
* which deterministic signals exist
* what is missing
* whether the lead is ready for deeper intelligence
* what next step is recommended

M2.0 does not perform external research, enrichment, discovery, fact verification, outbound sending, or LLM synthesis. It must not invent company facts such as industry, size, location, founder, funding, hiring, intent, or website activity unless those facts are present in stored evidence.

M2.0 separates:

* lead status
* intelligence status
* data readiness
* qualification foundation
* recommendation
* outbound activity

A lead can be `NEW`, ready for intelligence, and still have intelligence status `NOT_RUN`. That state is valid and should not be shown as "intelligence available."

The M2.0 product concept is:

```text
Customer Lead Data
  -> Lead Data Foundation
  -> Evidence
  -> Claims
  -> Signals
  -> Data Readiness
  -> Qualification Foundation
  -> Recommended Next Step
  -> Outbound Automation
```

The M2.0 recommended next step is conservative. Email or phone presence is a data signal, not enough to claim that the best action is outbound contact. Real next-best-action intelligence, personalization, and outbound providers are later milestones.

Future research providers will feed evidence into the same model:

```text
Future Research Providers
  -> Evidence
  -> AI Lead Intelligence
```

M2.2 introduces structured synthesis and qualification over persisted evidence:

```text
Lead Data Foundation
  -> Evidence
  -> Current Intelligence Snapshot
  -> Staged Research Evidence
  -> Structured Lead Intelligence Synthesis
  -> Qualification Foundation
```

The current M2.2 implementation validates the synthesis and qualification contract with a deterministic local agent. It does not call real LLM providers or perform external research. Future LLM providers should produce the same evidence-grounded structured output rather than bypassing the Lead Intelligence domain.

M2.3 turns synthesis into recommendation intelligence:

```text
Structured Lead Intelligence Synthesis
  -> Attention Priority
  -> Segment
  -> Personalization Context
  -> Recommended Next Step
```

The current M2.3 implementation does not create outbound actions or execute messages. It prepares evidence-grounded recommendation intelligence for human review and future M3 action planning.

M3 turns recommendation intelligence into a policy-checked plan:

```text
Evidence-Grounded Recommendation Intelligence
  -> Next Best Action Plan
  -> Policy Decision
  -> Approval Requirement
  -> Outbound Automation readiness
```

The current M3 implementation still does not send messages or execute provider work. It answers what should happen next, why, whether policy allows it, and whether human approval is required before any future outbound execution milestone.

M3.1 is a product UX and information architecture pass over the existing M0-M3 implementation. The normal customer UI must explain:

```text
Customer data -> Lead Data Foundation -> Lead Intelligence -> Next Best Action -> Human review -> Outbound later
```

It must not present sandbox execution, callbacks, handler details, pipeline versions, raw evidence identifiers, or deterministic implementation details as the primary product experience.

M4 turns eligible plans into sandbox outbound actions:

```text
Next Best Action Plan
  -> Prepared Outbound Action
  -> Execution Attempt
  -> Sandbox Handler / Mock n8n Boundary
  -> Callback
  -> Persisted Activity
```

The current M4 implementation is still a foundation. It proves execution state, retries, idempotency, and callback history without adding real channels, real provider credentials, production n8n workflows, message generation, or approval queues. During M3.1, those mechanics remain isolated from the normal customer flow.

M5 adds human review before approval-required outbound actions can proceed. M6/M7 foundation then adds normalized channel activity, mock inbound events, and persisted follow-up state:

```text
Approved Recommended Step
  -> Sandbox Outbound Activity
  -> Channel Message
  -> Inbound Event
  -> Follow-up State
  -> Future Lead Intelligence Update
```

This foundation keeps email, WhatsApp, SMS, voice, CRM, bots, and n8n behind replaceable channel/handler/provider boundaries. It does not configure real providers, production n8n workflows, autonomous bots, bulk outbound, campaign sequencing, AI reply classification, or voice agents yet.

M6 sequence foundation adds campaign, sequence, sequence-step, and workflow-run state:

```text
Campaign
  -> Sequence
  -> Sequence Step
  -> Workflow Run
  -> Approval / Action / Channel Activity
  -> Stop on Response
```

The current implementation proves idempotent enrollment, wait states, approval-gated steps, and basic stop conditions. It does not provide a full campaign builder, production scheduler, real outbound providers, autonomous bulk sending, or AI reply classification.

## Lead Data Sources

The core product should support customer-owned data such as:

* CSV
* Google Sheets
* CRM
* website forms
* application forms
* databases
* manual entry
* existing customer records
* enquiry records
* other connected systems

The product should not assume customers have sophisticated structured data.

M1 product concept:

```text
Turn customer-owned lead data into a clean, traceable foundation ready for AI Lead Intelligence.
```

CSV is the first ingestion adapter for that foundation. CSV is not the whole ingestion architecture.

## Target Customers

The initial market includes businesses such as:

* real estate
* construction
* furniture
* interior design
* local services
* agencies
* other SMBs with lead/customer/enquiry data

These businesses may have:

* spreadsheets
* old leads
* enquiries
* customer lists
* WhatsApp contacts
* website submissions
* CRM records
* manually maintained databases

The product must be useful even when the customer's data is messy.

## Example: Real Estate

Input:

```text
Thousands of enquiries
```

Lead Intelligence may determine:

* property interest
* location
* budget
* timeline
* lead quality
* recency
* potential intent
* missing information
* priority

Outbound Automation may then:

* draft WhatsApp communication
* request human approval
* send
* schedule follow-up
* process replies
* stop when appropriate

## Example: Furniture

Input:

```text
Past customers
Old enquiries
Website leads
WhatsApp contacts
```

Lead Intelligence may identify:

* dormant leads
* likely repeat buyers
* product interests
* high-value customers
* upgrade opportunities
* incomplete profiles

Outbound Automation can then execute appropriate campaigns or follow-ups.

## Example: Construction

Input:

```text
Builders
Developers
Architects
Property owners
Historical enquiries
```

Lead Intelligence may:

* identify relevant companies
* research projects
* identify signals
* determine potential relevance
* identify decision makers where possible
* score opportunities

Outbound Automation can then execute appropriate outreach or create human tasks.

---

# Lead Discovery

Lead Discovery is an optional plugin/capability.

It is not the definition of the product.

Potential discovery sources include:

* Google Maps/Places
* business directories
* public company websites
* permitted public web data
* public registries
* external lead databases
* other third-party data providers

Discovery providers produce normalized lead candidates that enter the same Lead Intelligence pipeline.

```text
Discovery Provider
       ↓
LeadCandidate
       ↓
Normalization
       ↓
Lead Intelligence
```

The core system must not depend on a particular discovery provider.

Apollo and similar platforms may be supported as optional sources/providers where commercially and technically appropriate.

---

# Outbound Automation

Outbound Automation operates on Lead Intelligence.

It may include:

* campaigns
* sequences
* scheduled actions
* conditional actions
* WhatsApp
* email
* SMS
* human tasks
* CRM actions
* follow-ups
* reply handling

Channels should be added based on customer value rather than attempting to support everything immediately.

---

# Human-in-the-Loop

Humans should remain involved where appropriate.

The system may:

1. generate intelligence
2. recommend an action
3. generate a communication
4. request approval
5. allow editing
6. execute
7. record the outcome

Human approval is a configurable product capability.

---

# Product Architecture Philosophy

The product should be:

* modular
* loosely coupled
* provider-independent
* observable
* testable
* scalable
* safe to extend

n8n may be used for connector and handler execution.

n8n is not the product's business-logic layer or source of truth.

---

# MVP

The MVP should prove the central product loop:

```text
Import Leads
    ↓
Normalize
    ↓
View Leads
    ↓
Generate Lead Intelligence
    ↓
Qualify / Score
    ↓
Recommend Next Best Action
    ↓
Human Approval
    ↓
Execute Action
    ↓
Record Result
```

The first version should use mock/sandbox integrations where real provider integrations would slow architectural validation.

---

# Non-Goals for MVP

Do not initially attempt to build:

* a full Apollo competitor
* a proprietary massive lead database
* a full CRM replacement
* every outbound channel
* unrestricted autonomous agents
* complex enterprise infrastructure
* microservices without a concrete need
* dozens of integrations

The priority is proving the Lead Intelligence → Outbound Automation loop.

---

# Success Criteria

The MVP should demonstrate that a business can provide imperfect lead data and the system can:

1. ingest it
2. normalize it
3. understand it
4. enrich/research where useful
5. qualify it
6. score it
7. explain useful intelligence
8. recommend an appropriate action
9. generate an appropriate communication/action
10. obtain human approval when required
11. execute the action
12. record the outcome
13. use the resulting event to update intelligence
14. determine the next action
