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
- A Render account. The blueprint uses the **Free** plan. Two trade-offs, both
  fine for staging: the instance sleeps after ~15 minutes without traffic and
  takes about a minute to wake (the background worker is paused while asleep),
  and `preDeployCommand` is unavailable, so migrations run at boot instead.
  Switch to Starter before real customers rely on it.
  (Heroku is not an alternative — it no longer has a free tier.)
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

## Step 2 — Put a connection string in a local `.env`

In the project, click **Connect** → **Direct** → **Connection string**. Ignore the
Framework, Server, ORM, MCP and API Keys tabs — Relay talks to PostgreSQL
directly and needs none of them. Never put the `service_role` API key anywhere in
this project.

Supabase shows three strings. Using the wrong one in the wrong place is the most
common failure:

| Which | Host | Port | Use for |
| --- | --- | --- | --- |
| Direct connection | `db.<ref>.supabase.co` | `5432` | Only if your network has IPv6 (see below) |
| **Session pooler** | `aws-0-<region>.pooler.supabase.com` | `5432` | **Your local `.env`**: `verify:deploy`, `test:pg`, migrations |
| **Transaction pooler** | `aws-0-<region>.pooler.supabase.com` | `6543` | **Render's `DATABASE_URL`** |

**Why not Direct:** on free Supabase projects the direct connection is
IPv6-only. Most home and office networks, and Render itself, reach the internet
over IPv4, so it simply times out. The session pooler is IPv4-compatible and
behaves like a direct connection, which is why it is the one to use locally.

Create `.env` in the repository root — it is gitignored and will not be
committed:

```
DATABASE_URL=postgresql://postgres.YOUR_REF:YOUR_PASSWORD@aws-0-YOUR_REGION.pooler.supabase.com:5432/postgres
```

Replace `[YOUR-PASSWORD]` in the copied string with the real password. **If the
password contains any of `@ : / ? # % &`, URL-encode those characters**
(`@` → `%40`, `#` → `%23`, and so on), or the connection string will not parse.

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

Expect **219 passed**.

This is safe to point at the staging database. Every test works inside its own
generated schema, nothing touches `public`, and leftover schemas are dropped at
the end. (An earlier version of the adapter tests ran `DROP SCHEMA public
CASCADE`, which would have destroyed whatever database it was aimed at. That is
gone.)

If `verify:deploy` cannot connect, it is almost always one of: the Direct
(IPv6-only) string on an IPv4 network, the wrong password or an un-encoded
special character in it, a paused project (Supabase pauses free projects after a
week of inactivity), or database network restrictions.

Not yet verified against a real Supabase pooler: the test harness selects a
per-test schema through a `search_path` startup option in the connection string.
If `test:pg` fails with an error mentioning `options` or `search_path` while
`verify:deploy` passes, the pooler is rejecting that option — that is a test
harness limitation, not an application problem, and the harness will need a
different way to select the schema.

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

   Note this is the **transaction pooler** (port 6543), not the session pooler
   you used locally. Keep the plan as **Free** when Render asks.

   Everything else — `NODE_ENV`, `LOG_LEVEL`, `LOG_FORMAT`, `TRUST_PROXY`,
   `FORCE_SECURE_COOKIES`, `WORKER_ENABLED`, `NODE_VERSION` — is already in the
   blueprint.

   Without an LLM key the product still works end to end on its deterministic
   local agents.

4. **Apply**, and watch the deploy.

### What the blueprint does, and why

Deploy order: `npm ci` → client build → `npm start` (which applies pending
migrations before listening) → health check.

- **Build** — `npm ci && npm --prefix client ci --include=dev && npm --prefix
  client run build`. The server serves `client/dist`; without the client build
  the service serves a stale bundle or nothing. `--include=dev` is deliberate:
  vite and typescript are devDependencies, which npm omits whenever `NODE_ENV` is
  `production`. It is `staging` here so they would install anyway, but relying on
  that would break the day this is copied to production.
- **Migrations at boot** — the free plan has no `preDeployCommand`, so
  migrations run when the server opens the database. A failed migration makes the
  process exit, `/api/health/ready` never goes green, and Render does not route
  traffic to that instance. On a paid plan, add
  `preDeployCommand: npm run db:migrate` back so a bad migration fails the deploy
  before the old instance is replaced.
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

Then run the automated workflow checks against the deployed URL — this is the
same 55 checks used locally, and it creates its own throwaway workspace so it is
safe against staging:

```bash
VERIFY_BASE_URL=$BASE npm run verify:workflows
```

Expect **55/55**. Then in a browser:

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
