# Deployment

How Relay is deployed: **Supabase** for PostgreSQL, **Render** for the Node
service. Staging first; production is the same document with a second project and
`NODE_ENV=production`.

Nothing in the application knows which environment it is in beyond the
environment variables it is given. Setting `DATABASE_URL` is the entire switch
from SQLite to PostgreSQL — there is no build flag and no code path to change.

**Secrets never go in chat, in git, or on a command line.** The connection string
lives in a local `.env` (gitignored) for local verification, and in Render's
dashboard for the deployed service. Every script here reads it from the
environment and prints only the host.

Current branch for deployment: **`mvp`**.

---

## Status

| | |
| --- | --- |
| Adapter verified on real PostgreSQL | Yes — 180/180 tests on PostgreSQL 18.1 |
| Server boots and serves on PostgreSQL | Yes — verified locally |
| Render blueprint validated | Yes — build, migrate and boot sequences simulated locally |
| Supabase project created | **No — needs your account** |
| Render service created | **No — needs your account** |

---

## Before you start

- A Supabase account (free tier is enough for staging).
- A Render account. Use **Starter**, not Free: `preDeployCommand` is unavailable
  on Free, and Free instances sleep, which stops the background worker.
- Push access to this repository.

---

## Step 1 — Create the Supabase project

1. <https://supabase.com/dashboard> → **New project**.
2. Name it `relay-staging`. Pick the region nearest your users (Mumbai or
   Singapore for India).
3. Save the generated database password **in your password manager now** — it is
   shown once and it is part of every connection string.
4. Wait for provisioning (~2 minutes).

---

## Step 2 — Put the direct connection string in a local `.env`

Project Settings → **Database** → **Connection string** → **URI**. Supabase gives
you two, and using the wrong one in the wrong place is the most common failure:

| Which | Port | Use for |
| --- | --- | --- |
| **Direct connection** | `5432` | migrations, `verify:deploy`, `test:pg`, `psql` |
| **Transaction pooler** | `6543` | the running Render service (`DATABASE_URL`) |

A web service opens many short-lived connections; Supabase's direct connection
limit is small and will be exhausted. The pooler exists for exactly that.

Create `.env` in the repository root — it is gitignored and will not be
committed:

```
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@db.YOUR_REF.supabase.co:5432/postgres
```

Leave `DATABASE_SSL` unset. Supabase requires TLS, which is the default.

---

## Step 3 — Verify against the real database

```bash
npm run verify:deploy
```

Seven checks, stopping at the first failure: configuration resolves to
PostgreSQL, the server is reachable, migration state before, migrations apply,
migration state after (nothing pending), the schema really exists (all 25
required tables plus the idempotency indexes the product's correctness depends
on), and whether a staging boot would be accepted by `validateConfig()`.

Then run the whole suite against the real database:

```bash
npm run test:pg
```

Expect **180 passed**.

This is safe to point at the staging database. Every test works inside its own
generated schema, nothing touches `public`, and leftover schemas are dropped at
the end. (An earlier version of the adapter tests ran `DROP SCHEMA public
CASCADE`, which would have destroyed whatever database it was aimed at. That is
gone.)

If `verify:deploy` cannot connect, it is almost always one of: the wrong
password, the pooler host where the direct host is needed, a paused project
(Supabase pauses free projects after inactivity), or database network
restrictions.

---

## Step 4 — Push the branch

```bash
git push -u origin mvp
```

---

## Step 5 — Create the Render service

1. <https://dashboard.render.com> → **New** → **Blueprint**.
2. Connect this repository and select the **`mvp`** branch. Render reads
   `render.yaml` and proposes the `relay-staging` web service.
3. Set the three secrets Render asks for. They are `sync: false` in the
   blueprint, so Render will not invent them:

   | Variable | Value | Required? |
   | --- | --- | --- |
   | `DATABASE_URL` | The Supabase **pooler** string, port **6543** | Yes |
   | `LLM_PROVIDER` | `groq` | Optional |
   | `GROQ_API_KEY` | Your Groq key | Optional |

   Note this is the **pooler** string, not the direct one you used locally.

   Everything else — `NODE_ENV`, `LOG_LEVEL`, `LOG_FORMAT`, `TRUST_PROXY`,
   `FORCE_SECURE_COOKIES`, `WORKER_ENABLED`, `NODE_VERSION` — is already in the
   blueprint.

   Without an LLM key the product still works end to end on its deterministic
   local agents.

4. **Apply**, and watch the deploy.

### What the blueprint does, and why

Deploy order: `npm ci` → client build → `npm run db:migrate` → `npm start` →
health check.

- **Build** — `npm ci && npm --prefix client ci --include=dev && npm --prefix
  client run build`. The server serves `client/dist`; without the client build
  the service serves a stale bundle or nothing. `--include=dev` is deliberate:
  vite and typescript are devDependencies, which npm omits whenever `NODE_ENV` is
  `production`. It is `staging` here so they would install anyway, but relying on
  that would break the day this is copied to production.
- **Pre-deploy** — `npm run db:migrate` runs *before* the new instance replaces
  the old one, so a bad migration fails the deploy rather than taking the service
  down. It exits non-zero if anything is still pending, which is what Render
  gates on.
- **Health check** — `/api/health/ready`. This is *readiness*, not liveness: it
  returns 503 while the database is unreachable or a migration is pending, so a
  half-deployed instance never receives traffic. `/api/health/live` (and its
  original alias `/api/health`) is liveness and deliberately does not touch the
  database, so a database blip never causes the platform to restart a healthy
  process.
- **HTTPS** — Render terminates TLS and forwards over plain HTTP. `TRUST_PROXY`
  is what lets the app read `X-Forwarded-Proto` and mark session cookies
  `Secure`. It is off by default locally, because trusting that header from an
  arbitrary client would let it claim HTTPS and be issued a Secure cookie over
  plaintext.
- **`autoDeploy: false`** — the first deploy is deliberate. Turn it on in the
  dashboard once you have seen a green one.

---

## Step 6 — Verify the deployment

In order. Stop at the first failure; each step depends on the one before.

```bash
BASE=https://relay-staging.onrender.com

curl -s $BASE/api/health/live   # {"status":"ok","check":"live"}  — process is up
curl -s $BASE/api/health/ready  # {"status":"ready", ... "migrations":{"pending":[]}}
```

Then in a browser:

3. **Registration** — create a workspace. You should land on the dashboard.
4. **Session cookie** — DevTools → Application → Cookies. `relay_session` must
   have **`Secure`** and **`HttpOnly`**. If `Secure` is missing, `TRUST_PROXY` is
   not taking effect.
5. **Login** — sign out, sign back in.
6. **Tenant isolation** — register a *second* workspace in a private window, then
   try to open the first workspace's lead URL from it. It must 403/404.
7. **CSV import** — Leads → Import. Preview, then commit.
8. **Intelligence** — open a lead → Refresh intelligence. Readiness,
   qualification, recommendation and next step should all reach Done, with
   evidence listed.
9. **Outbound** — approve the generated action, send it, and confirm the
   conversation entry and the auto-scheduled follow-up appear.
10. **Logs** — Render → Logs. Every line should be a single JSON object with an
    `event` field. Pick a request's `request_id` and confirm it appears on that
    request's lines.

---

## Operational notes

### Scaling past one instance

The background worker runs **in-process** on an interval. That is correct for a
single instance and wrong for several: multiple instances would race to execute
the same actions. The idempotency keys make double-*sending* unlikely rather than
impossible, and this has not been load-tested.

Before scaling horizontally, either set `WORKER_ENABLED=false` on all but one
instance, or split the worker into its own Render background service. The
environment variable exists for exactly this.

### Migrations

- `npm run db:status` reports applied and pending migrations and changes nothing.
  Safe against production.
- `npm run db:migrate` applies pending migrations and exits non-zero on failure.
- Never edit or reorder a released migration — deployed databases have recorded
  it and will not run it again. Add a new one.

### Rollback

Render keeps previous deploys — roll back from the dashboard. A rollback does
**not** revert migrations, so migrations must stay backwards-compatible with the
previous release: add columns, and do not drop or rename them in the same deploy
that stops using them.

### Backups

Supabase takes daily backups on paid plans; the free tier does not. Before this
carries real customer data, either upgrade or schedule `pg_dump` somewhere
durable. **Not yet done.**

---

## Deliberately not done

So it is not mistaken for finished:

- **No production environment.** Staging only. Production is a second Render
  service and a second Supabase project with `NODE_ENV=production`.
- **No custom domain**, beyond Render's `*.onrender.com`.
- **No backups configured.**
- **No rate limiting**, on authentication or anywhere else.
- **No webhook signature verification** — the SendGrid routes authenticate with
  an opaque token in the URL, not a signature.
- **No LLM cost controls.**
- **No data retention policy.**

These are the remaining `M10` items.
