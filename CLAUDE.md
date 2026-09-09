# CLAUDE.md — Relay

## Project Identity

**Relay** — AI Lead Intelligence & Outbound Automation Platform

A modular SaaS platform that transforms fragmented lead data into actionable intelligence and automates outbound actions. Built for SMBs across any vertical (real estate, furniture, SaaS, construction, services).

Two primary pillars:
1. **AI Lead Intelligence** — understand leads, qualify, score, segment, recommend next steps
2. **Outbound Automation** — execute actions based on intelligence (email, WhatsApp, SMS, voice, human tasks)

## Quick Start

```bash
# Backend (requires Node.js 24+, uses node:sqlite)
npm start                        # Start backend on http://localhost:3000
node --env-file=.env src/server.js  # Start with LLM env vars (.env has LLM_PROVIDER, API key)
npm test                         # Run all backend tests (Node.js built-in test runner)
npm run ci                       # Lint + format check + test
npm run dev:reset                # Reset local dev database (backs up first)
npm run dev:seed:qa              # Seed QA data for manual testing
npm run smoke                    # Run API smoke tests
npm run db:migrate               # Apply pending migrations and exit (deploy pre-step)
npm run db:status                # Report applied/pending migrations, changing nothing
npm run dev:e2e                  # Real server on port 3100 + isolated DB, for browser QA
npm run test:pg                  # Run the WHOLE suite against PostgreSQL (reads DATABASE_URL from .env)
npm run verify:deploy            # Pre-deploy checks: connectivity, migrations, schema, config

# Frontend (React + Vite)
cd client && npm install         # Install frontend dependencies (first time)
cd client && npm run dev         # Start Vite dev server on http://localhost:5173
cd client && npx tsc --noEmit    # TypeScript type check
```

Database is auto-created at `data/app.db` on first start. No setup required.

`npm start` and the db/test scripts load a local `.env` automatically via
`--env-file-if-exists`, so `node --env-file=.env src/server.js` is no longer needed.
Secrets belong in `.env` (gitignored) or the deployment platform — never on a
command line, and never committed. `.env.example` documents every variable.

### AI Provider Setup (optional)
Create a `.env` file in the project root:
```
LLM_PROVIDER=groq
GROQ_API_KEY=your-key-here
```
Then start the server with `node --env-file=.env src/server.js`. Supported providers: `groq`, `openai`, `openrouter`, `ollama`.

## Tech Stack

- **Runtime**: Node.js 24+ (ESM modules, `"type": "module"`)
- **Backend**: Raw `node:http` server, modular monolith architecture. One runtime dependency (`pg`); everything else is Node built-ins
- **Database**: SQLite (`node:sqlite`) for local dev and tests, PostgreSQL/Supabase for staging and production, behind one async `DatabaseClient` contract. Versioned migrations in `src/database/migrations/`
- **Frontend**: React 19 + Vite 8 + TailwindCSS v4 + shadcn/ui in `client/` (legacy vanilla HTML/CSS/JS still in `public/`)
- **Testing**: Node.js built-in test runner (`node --test`), 22 test files, 180 tests; TypeScript type checking in `client/`. The suite runs on SQLite by default and on real PostgreSQL via `npm run test:pg` — CI runs both. Note `node --test` auto-discovers any file matching `test-*.js`/`*-test.js` anywhere in the repo, so don't name a non-test script that way
- **AI**: LLM Provider Abstraction supporting Groq, OpenAI, OpenRouter, Ollama (deterministic local agents as fallback when no LLM configured)
- **CI**: GitHub Actions (`.github/workflows/ci.yml`)

## Directory Structure

```
src/
  server.js                    # Entry point: config validation, boot, graceful shutdown
  config.js                    # ALL environment configuration + validation (the only env reader)
  api/app.js                   # All HTTP routes (~50 endpoints) + static file serving
  database/
    database.js                # createDatabase() -> driver selection + migrations
    sqliteClient.js            # SQLite implementation of the DatabaseClient contract
    postgresClient.js          # PostgreSQL implementation (pg pool, ?->$n, type coercion)
    sql.js                     # Placeholder translation + statement splitting
    migrate.js                 # Migration runner (schema_migrations, transactional)
    migrations/                # Versioned, ordered migrations
  shared/
    http.js                    # JSON request/response helpers, static file server, sendError
    logger.js                  # Structured logger (JSON when deployed, text locally)
    errors.js                  # Error taxonomy: status + code + expected/defect
    ids.js                     # UUID-based ID generator with prefix (org_, lead_, etc.)
    time.js                    # ISO timestamp helper
  modules/
    data-foundation/           # Lead ingestion, CSV parsing, normalization, imports, duplicate detection
    lead-intelligence/         # Intelligence snapshots, synthesis, recommendations, research evidence
    next-best-action/          # Action planning, policy engine
    outbound-automation/       # Actions, executions, approvals, callbacks
    channels/                  # Channel messages, inbound events, follow-ups
    workflows/                 # Campaigns, sequences, sequence steps, workflow runs
    events/                    # Domain events queue, audit repository
    handlers/                  # Action executor, mock n8n adapter, LLM provider abstraction

client/                        # React frontend (React 19 + Vite 8 + TailwindCSS v4 + shadcn/ui)
  src/
    pages/                     # Page components (dashboard, leads, lead-detail, intelligence,
                               #   intelligence-detail, outbound, conversations, activity, settings)
    components/                # Reusable UI components (layout/, ui/)
    hooks/                     # Custom hooks (use-leads, use-intelligence, use-outbound, etc.)
    stores/                    # Zustand stores (workspace)
    lib/                       # Utilities (api client, utils)
    types/                     # TypeScript type definitions
  vite.config.ts               # Vite config with API proxy to localhost:3000

public/                        # Legacy frontend (vanilla HTML/CSS/JS SPA, being replaced by client/)

test/                          # 22 test files + fixtures + helpers
scripts/                       # dev-reset, dev-seed-qa, lint, format-check, smoke-api
docs/                          # ARCHITECTURE.md, DOMAIN.md, PRODUCT.md, ROADMAP.md, TASKS.md, TESTING.md
```

## Key Architecture Patterns

### Repository Pattern
Every domain module has its own repository class wrapping database operations. Services consume repositories, never raw SQL. Repository methods are the only code that touches the database.

### Contract-First
Each domain area has explicit contract files defining types, statuses, and vocabulary (e.g., `intelligenceContract.js`, `actionContract.js`, `channelContract.js`). Contracts are the source of truth for valid states and transitions.

### Idempotency Everywhere
Nearly every write operation has idempotency keys and deduplication. Duplicate requests never create duplicate side effects. This applies to imports, intelligence runs, synthesis, recommendations, actions, executions, callbacks, channel messages, inbound events, and workflow enrollment.

### Organization-Scoped (Multi-tenant)
All data is isolated by `organization_id`. Every query must be tenant-scoped. Cross-tenant access is a bug.

### Provider-Independent
External providers (email, WhatsApp, LLM, n8n) are behind adapter/handler interfaces. Core domain modules never depend on a specific provider. If n8n/a provider is replaced, only the adapter changes.

### State Machines
Entities use explicit state machines with defined transitions. Key state machines: ImportBatch, IntelligenceSnapshot, SynthesisRun, RecommendationRun, NextBestActionPlan, Action, ActionExecution, ActionApproval, WorkflowRun, FollowUpTask.

### Database Client Contract
All database access goes through an **async** contract: `await exec(sql)`, `await run(sql, params)`, `await get(sql, params)`, `await all(sql, params)`, `await columnExists(table, column)`, `await transaction(fn)`, `await close()`.

Two implementations satisfy it identically — `SqliteDatabaseClient` (local dev and tests; still synchronous underneath) and `PostgresDatabaseClient` (staging and production, via `pg`). Setting `DATABASE_URL` is the entire switch between them; no module code changes.

Repositories write SQLite-flavoured SQL with `?` placeholders. The PostgreSQL client rewrites `?` to `$1..$n` and coerces BIGINT/NUMERIC to `Number`, so there is only ever one dialect of SQL in the codebase. Do not write engine-specific SQL (`datetime('now', ...)`, `date(col)`, `PRAGMA`) — compute date cutoffs in JavaScript and pass them as parameters.

## Database

- SQLite at `data/app.db` (auto-created on start)
- 22+ tables, 20+ indexes for query performance and idempotency
- Schema defined inline in `src/database/database.js` via `migrateDatabase()`
- Uses `CREATE TABLE IF NOT EXISTS` + `ensureColumn()` helper for additive migrations
- No separate migration files — all DDL in one place
- Key tables: `organizations`, `users`, `leads`, `import_batches`, `import_rows`, `import_issues`, `intelligence_snapshots`, `intelligence_evidence`, `intelligence_claims`, `intelligence_signals`, `intelligence_qualifications`, `intelligence_recommendations`, `research_evidence_ingestions`, `research_evidence_items`, `intelligence_synthesis_runs`, `intelligence_recommendation_runs`, `next_best_action_plans`, `domain_events`, `actions`, `action_executions`, `action_approvals`, `callbacks`, `channel_messages`, `inbound_events`, `follow_up_tasks`, `campaigns`, `sequences`, `sequence_steps`, `workflow_runs`, `audit_logs`

## API

- All routes defined in `src/api/app.js` using `method + pathname` pattern matching
- ~50 endpoints covering: health, organizations, leads, imports (CSV), intelligence, research evidence, synthesis, recommendations, next-best-action, outbound actions, approvals, channels, follow-ups, timeline, campaigns, sequences, workflows
- JSON request/response via helpers in `src/shared/http.js`
- Non-`/api/` paths serve static files from `public/` (legacy) or proxied from Vite dev server (`client/`)
- `escapeHtml()` used in legacy frontend for XSS prevention; React frontend uses JSX auto-escaping
- AI status endpoint: `GET /api/ai/status` — reports configured provider, model, and connection state
- Settings categories: `channel_email`, `channel_whatsapp`, `channel_sms`, `channel_telegram`, `channel_call`, `ai_provider`

## Milestone Status

- **M0** (Architecture + Walking Skeleton): Complete
- **M1** (Lead Data Foundation — CSV import, normalization): Complete
- **M1.1** (Lead Data Foundation UX Refinement): Complete
- **M2.0** (AI Lead Intelligence Foundation): Complete
- **M2.1** (Research Evidence Adapters): Complete
- **M2.2** (Structured Synthesis + Qualification): Complete
- **M2.3** (Recommendation Intelligence): Complete
- **M3** (Next Best Action Planning): Complete
- **M3.1** (Product UX Consistency): Complete
- **M4** (Outbound Automation Foundation): Complete
- **M5** (Human-in-the-Loop Approval): Complete
- **M6** (Sequences + Follow-Up Foundation): Complete
- **M7** (Response/Event Intelligence): Partial — mock inbound events and basic reply handling done; ReplyClassifier, human escalation, and intelligence update not done
- **M8** (Additional Channels): Not started
- **M9** (Lead Discovery): Not started
- **M10** (Production Hardening): Partial — Phase 5 production foundation done (PostgreSQL adapter, migrations, env/secrets config, structured logging + error taxonomy, health/readiness, graceful shutdown). Rate limiting, webhook signature verification, cost controls, backups and data retention still open

## Next Major Phases (Planned)

1. ~~Frontend revamp: React + Vite + TailwindCSS + shadcn/ui~~ **In progress** — scaffold, pages, and core flows built in `client/`
2. Executive dashboard with charts, KPIs, pipeline funnel
3. ~~Leads & Intelligence UI revamp~~ **In progress** — Leads, Intelligence, Intelligence Detail, Outbound, Settings pages built
4. Authentication & multi-tenancy
5. ~~AI integration: multi-provider LLM~~ **Partial** — LLM provider abstraction built (Groq/OpenAI/OpenRouter/Ollama), AI status endpoint live; synthesis/recommendation/message generation with real LLM pending
6. Inbound channels: web chat widget, WhatsApp, SMS, email with AI-powered responses
7. Outbound real providers + visual campaign builder
8. Voice: open source stack (LiveKit + Whisper + Piper TTS)
9. Organization knowledge base & bot configuration
10. Lead discovery plugins

## Code Conventions

- ESM modules throughout (`import`/`export`, no `require`)
- 2-space indent, double quotes, no trailing commas (`.prettierrc.json`)
- LF line endings, UTF-8 (`.editorconfig`)
- Prefix IDs with entity type: `org_`, `lead_`, `imp_`, `snap_`, `act_`, `exec_`, `syn_`, `rec_`, `nba_`, `cam_`, `seq_`, `wfr_`, `cha_`, `ibe_`, `fut_`
- ISO 8601 timestamps everywhere via `src/shared/time.js`
- Test files: `test/<module-name>.test.js`
- Custom lint (`scripts/lint.js`) and format check (`scripts/format-check.js`)

## What NOT to Do

- Don't couple domain logic to n8n or any specific provider
- Don't store important state only in frontend, n8n, LLM context, or provider systems
- Don't build outside the active milestone without justification
- Don't weaken, skip, or delete failing tests
- Don't introduce microservices prematurely — modular monolith first
- Don't invent facts in AI agents — all intelligence must be evidence-grounded
- Don't allow AI to bypass domain policy or approval requirements
- Don't make Lead Discovery a core dependency — it's an optional plugin
- Don't reframe the product identity (it's not "AI SDR", "CRM replacement", or "sales OS")
- Don't write engine-specific SQL — it must run on both SQLite and PostgreSQL
- Don't read `process.env` outside `src/config.js` for anything environment-dependent
- Don't edit or reorder a released migration — add a new one
- Don't return a raw error message to a client for a 5xx; log it and return the request id

## Reference Docs

- `AGENTS.md` — Product identity (non-negotiable), engineering principles, agent roles, definition of done
- `docs/PRODUCT.md` — Product vision, target customers, vertical examples, success criteria
- `docs/ARCHITECTURE.md` — High-level architecture, module responsibilities, dependency direction, implementation notes per milestone
- `docs/DOMAIN.md` — Domain model definitions (30+ entities with states and rules)
- `docs/ROADMAP.md` — Milestones M0-M10 with deliverables and exit criteria
- `docs/TASKS.md` — Task tracker with completion status and architecture change log
- `docs/TESTING.md` — Testing strategy and QA checklists per milestone
- `docs/DEPLOYMENT.md` — Supabase + Render deployment runbook, verification steps, operational notes
- `render.yaml` — Render blueprint for the staging service (branch `mvp`)
- `docs/status.html` — Live build-status tracker across the six phases to MVP
