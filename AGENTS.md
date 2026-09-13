# AGENTS.md

## Product Identity — NON-NEGOTIABLE

The product is:

# AI Lead Intelligence & Outbound Automation

This product identity must remain consistent across architecture, code, UI, documentation, milestones, terminology, and future agent decisions.

Do not reframe the product as:

* an AI sales agent
* an AI SDR
* a sales operating system
* a CRM replacement
* an autonomous salesperson

These may describe capabilities or comparable products, but they are not the product identity.

## Product Hierarchy

The product has two primary pillars:

1. **AI Lead Intelligence**
2. **Outbound Automation**

Lead Intelligence is the core product capability.

Outbound Automation is the execution layer that acts on Lead Intelligence.

Lead Discovery is an optional extensible capability/plugin. It is not the core product.

The core conceptual flow is:

```text
Lead Sources
    ↓
Lead Data Foundation
    ↓
AI Lead Intelligence
    ↓
Next Best Action
    ↓
Outbound Automation
    ↓
Response / Event
    ↓
Updated Lead Intelligence
    ↓
Next Best Action
```

## Before Doing Any Work

Read:

1. `docs/PRODUCT.md`
2. `docs/ARCHITECTURE.md`
3. `docs/DOMAIN.md`
4. `docs/ROADMAP.md`
5. `docs/TASKS.md`
6. `docs/TESTING.md`

Then identify:

* current milestone
* current task
* dependencies
* acceptance criteria
* automated testing requirements
* human QA requirements

Do not begin unrelated work unless it is required to complete the current task.

### Current Planning and Documentation

The active launch sequence is L0-L6 in docs/ROADMAP.md. docs/TASKS.md owns current task status; docs/REVIEW.md owns the review evidence register; docs/DECISIONS.md records decision status and architectural tradeoffs; docs/PILOT.md defines customer-validation and launch evidence. Historical M0-M10 work is preserved under docs/history/ and is not current launch certification. docs/status.html is a historical visualization until separately reconciled.

Distinguish implemented behavior, proposed contracts, historical verification, and live human/provider QA. Update the affected Markdown specifications alongside every implementation slice and record verification evidence before closing tasks. Preserve the architecture-change procedure below.

For parallel implementation, agree exact file/module ownership first. One integrating owner controls shared API wiring, global contracts/configuration, migration registry, and package scripts within a batch. Resolve dependent contracts before other agents implement against them.

---

## Core Engineering Principles

### 1. Modular Monolith First

Build a modular, well-bounded application before introducing microservices.

Modules must have explicit responsibilities and dependency boundaries.

### 2. Lead Intelligence Is Core

Lead Intelligence must remain a first-class architectural domain.

It includes capabilities such as:

* normalization
* identity resolution
* enrichment
* research
* signal extraction
* qualification
* scoring
* segmentation
* personalization
* intelligence snapshots
* next-best-action recommendations

Do not allow outbound functionality to subsume or obscure this domain.

### 3. Outbound Automation Is the Execution Layer

Outbound Automation consumes Lead Intelligence and executes actions such as:

* messages
* follow-ups
* human tasks
* CRM actions
* scheduled actions
* multi-step sequences

Outbound automation must not become the source of truth for Lead Intelligence.

### 4. SaaS Owns Business Logic

The application owns:

* tenants
* users
* leads
* companies
* people
* intelligence
* campaigns
* sequences
* actions
* policies
* approvals
* state
* events
* audit history

External workflow tools must not become the authoritative application database.

### 5. n8n Is an Execution/Integration Layer

n8n may execute external workflows and connector operations.

Domain logic must never depend directly on n8n.

The application must be able to replace n8n later without rewriting the core domain.

### 6. External Providers Are Replaceable

Provider-specific logic must remain behind adapters/interfaces.

Examples:

* email
* WhatsApp
* CRM
* research
* enrichment
* lead discovery
* other data providers

Never spread provider-specific assumptions throughout core business logic.

### 7. Database Is the Source of Truth

Important state must be persisted in the application database.

Do not rely on:

* n8n execution history
* LLM context
* frontend state
* provider state

as the authoritative source of application state.

### 8. AI Is Bounded

AI may:

* research
* classify
* summarize
* identify signals
* qualify
* score
* segment
* personalize
* recommend actions
* draft communications

AI must not bypass application policy or arbitrarily mutate important state.

AI outputs should use structured schemas wherever practical.

### 9. Agent Handoffs Are Structured

Agents communicate using typed/validated contracts.

Do not rely on large free-form natural-language handoffs when structured data is possible.

### 10. Actions Are Idempotent

Every externally visible action must have an idempotency strategy.

Retries must not accidentally produce duplicate external side effects.

### 11. State Transitions Are Explicit

Statuses cannot be mutated arbitrarily.

State transitions must follow defined domain rules.

### 12. Human Approval Is First-Class

Approval, rejection, editing, and escalation are domain concepts.

They must not exist only as frontend behavior.

### 13. Observability Is Built In

Important operations should make it possible to determine:

* what happened
* when
* why
* which lead
* which workflow
* which agent
* which action
* which provider
* success/failure
* failure reason

### 14. Test Behavior

Prefer behavioral and contract testing over brittle implementation-specific tests.

---

## Agent Roles

Agents may specialize in:

* architecture
* backend/domain
* frontend
* AI/intelligence
* integrations/handlers
* QA/testing

Agents should minimize overlapping edits.

Each agent should have clear ownership of files/modules when working in parallel.

---

## Agent Handoff Requirements

When completing a meaningful task, report:

### Completed

What was implemented.

### Files Changed

Files/modules modified.

### Contracts Changed

Any API, event, schema, or interface changes.

### Tests

Tests added and results.

### Known Issues

Anything incomplete or uncertain.

### Human QA

What the human needs to verify.

### Next Step

Recommended next task.

---

## Task Completion Rule

A task is complete only when:

* implementation exists
* acceptance criteria are satisfied
* automated tests pass
* relevant documentation is updated
* human QA requirements are identified
* no known regression has been introduced

---

## Do Not

Do not:

* create unnecessary microservices
* couple domain logic to n8n
* couple core logic to a single provider
* build an Apollo clone as the core product
* make lead discovery a core dependency
* allow unrestricted autonomous AI agents
* store important state only in workflows
* silently weaken tests
* delete failing tests
* introduce speculative infrastructure
* build outside the active milestone without justification
* rename/reposition the product away from AI Lead Intelligence & Outbound Automation

---

## Architecture Changes

If implementation requires changing a documented architectural decision:

1. Stop.
2. Explain the conflict.
3. Propose the smallest viable change.
4. Update relevant documentation.
5. Record the decision.
6. Continue after the change is understood/approved.

---

## Definition of Done

Every milestone requires:

1. Automated tests passing.
2. Integration tests passing where applicable.
3. Failure/retry paths tested where applicable.
4. Human QA completed where specified.
5. Task tracker updated.
6. Documentation updated.
7. Working end-to-end demonstration.
