# Vercel frontend and independent interest capture

Product: **AI Lead Intelligence & Outbound Automation**. Updated 2026-09-14. ADR-025 owns this hosting boundary.

## Current result

The React/Vite frontend is prepared for Vercel with a root vercel.json and one Node gateway function. The product landing and walkthrough do not depend on an application session or backend availability. No cloud deployment has been performed: no Vercel project link, CLI login or deployment token was found locally, and no intake database credential was supplied. Local browser/HTTP proof is in [verification/VERCEL_AVAILABILITY](verification/VERCEL_AVAILABILITY.md).

Vercel supports Vite frontend deployments and Node functions. The application remains a modular Node backend with its own database and worker; it is not migrated into a function. See the official [Vite deployment guide](https://vercel.com/docs/frameworks/frontend/vite), [Node function runtime](https://vercel.com/docs/functions/runtimes/node-js), [routing configuration](https://vercel.com/docs/project-configuration/vercel-json) and [request header guarantees](https://vercel.com/docs/headers/request-headers).

## Deployment steps

1. Put this implementation on the selected Git branch, then import gshyam46/relay into the intended Vercel account/project. Use the repository root, not client, so api/gateway.js and its server-side imports are included. Choose Other as the framework preset; the committed configuration specifies install/build/output commands. Select Node 24. No new paid resource or subscription is required by this repository configuration; inspect your account's actual terms and quotas before enabling it.
2. Provision the acquisition schema once using [deployment/interest-schema.sql](../deployment/interest-schema.sql) on an explicit PostgreSQL/Supabase database. It creates only relay_interest and its three intake/operations tables. It does not migrate the application schema. Use an authorized migration connection for this step. The script intentionally fails if the schema already exists; inspect existing state rather than rerunning blindly.
3. Create a dedicated database LOGIN with a generated secret using your database administration tools. Grant it relay_interest_writer and no application-data, ownership or DDL privileges. Do not use the database owner, application administrator, migration credential or a browser-visible service-role key. Verify anonymous/authenticated public API roles cannot access relay_interest and the writer cannot read application tables. Supabase direct or session-pool networking follows the [existing deployment matrix](DEPLOYMENT.md); use verified TLS and encoded connection credentials.
4. Add the function-runtime environment values in the table below. Secrets belong in Vercel environment settings, never frontend code or a VITE_ variable. Keep preview and production configurations deliberate and separate.
5. Deploy a protected preview. Test the checklist below against its real URL and the isolated intake database. Then select the approved public frontend origin and release scope. Do not equate a successful Vite build with live intake, cookies or customer acceptance.

The configured install is npm ci && npm --prefix client ci --include=dev; build is npm --prefix client run build; static output is client/dist. API routes go to the function before the SPA fallback. Authentication/workspace deep links carry noindex and no-store headers. Local databases, logs, environment files, dependency folders and Vercel linkage are excluded from upload/version control. The existing Render blueprint remains independently configured with manual deployment.

## Runtime configuration

| Variable | Purpose |
| --- | --- |
| FRONTEND_ORIGIN | Exact HTTPS origin visitors use, without a trailing path. Required for the stable alias/custom domain so browser writes pass origin checks. A deployment URL is only a fallback for a matching Vercel preview URL. |
| BACKEND_ORIGIN | Optional exact HTTPS origin of the existing Node API. Leave unset to intentionally show Workspace access is coming soon. No path, credentials, query or redirect target is accepted. |
| INTEREST_DATABASE_URL | Dedicated least-privilege PostgreSQL connection for relay_interest. It is independent of the application's DATABASE_URL. |
| INTEREST_DATABASE_SSL_CA | Optional verified CA bundle when required by the selected PostgreSQL host. Certificate verification is never disabled. |
| INTEREST_ADMISSION_SECRET | Independently generated secret of at least 32 characters for intake admission hashing. Keep consistent across function instances. |

When connecting the backend, set its PUBLIC_APP_ORIGIN to the exact frontend origin and use secure cookies. The gateway forwards the original Origin and session cookie, preserves response Set-Cookie, and does not rewrite authentication into a token in browser storage. It never relays arbitrary Authorization/forwarded headers, disables caching, disallows redirects and pins the upstream to configuration. Live sends, worker setup, production data, provider webhooks and platform developer controls remain backend concerns. Provider callbacks use their documented backend URLs; they are not routed through this customer frontend gateway.

Gateway requests have a 12-second upstream deadline; JSON client requests have a 15-second deadline. Proxy bodies are limited to 1 MiB and responses to 4 MiB; larger import/export requests require a deliberately supported transfer path before release. An aborted POST is an unknown outcome, not proof that the backend cancelled it. There is no automatic replay of passwords, registrations or other mutations. Existing domain idempotency/review remains authoritative. The gateway trusts the Vercel-overwritten x-vercel-forwarded-for only when deployed on Vercel for acquisition admission; real forwarded-IP, auth-rate, cookie and network behavior still require deployment QA.

## What gets recorded

Successful signups remain normal application accounts with the existing password hashing/session implementation. Failed/unavailable signin/signup does not silently create an account or a tracking record. The user separately checks consent and submits name, email and optional business name for availability updates. Passwords, session tokens and arbitrary extra fields are rejected by the acquisition contract. Any prefill is in current component memory only. A failed account POST clears its password input and explains that account creation may already have completed.

The existing pilot payload accepts an optional purpose of AVAILABILITY_SIGNUP, AVAILABILITY_SIGNIN or AVAILABILITY_ONBOARDING. The service writes a fixed source description and corresponding availability_* -v1 consent version (without the space) using its existing request schema. Missing business names are explicitly recorded as Not provided. Demo/pilot requests keep their existing purpose and consent version. A request key binds exact normalized input; replay returns its original acceptance and conflicting details return 409. Acquisition rows are separate from organizations, users and customer leads.

On Vercel, both the demo form and availability form POST to /api/public/pilot-requests and the gateway writes directly to the acquisition schema even when BACKEND_ORIGIN is missing or unavailable. On the ordinary Node deployment, the same endpoint uses the application's existing intake tables. These are different deployment stores: records are not automatically synchronized into leads or across databases. The current 500/day global and 5/hour per-client admission limits, 10,000-record cap, explicit 90-day expiry and reviewed purge contract are retained. No positive save confirmation is returned during storage failure. If the intake database is also down, the page states that saving is unconfirmed and offers a same-request retry. An offline browser cannot transmit contact details.

## Reviewing and removing records

Use a separately authorized operator connection to the acquisition schema, with the rights needed to read/mark/purge its tables and record operation receipts. The deployed function's writer login intentionally lacks record update/delete and operations-table privileges. Set INTEREST_DATABASE_URL in the operator shell or explicitly loaded local environment and run:

~~~powershell
node scripts/interest-store.js list
node scripts/interest-store.js preview-purge
node scripts/interest-store.js mark C:/absolute/path/review-command.json
node scripts/interest-store.js purge C:/absolute/path/purge-command.json
~~~

list and preview-purge accept an optional absolute JSON options file; list supports status, limit up to 50 and after_id to page the queue. mark/purge require the existing reviewed command shapes in [pilot operations](L5-07_PILOT_INTEREST_OPERATIONS.md). No default database or automatic migrations are used. Keep operator output private because it contains contact details. Schedule and verify the operator review/purge process; expiry alone does not physically delete records. Messages are not sent automatically. The responsible operator must provide the actual privacy/support contact and handle requested correction/deletion before collecting public submissions.

## Human acceptance

- Directly open /, /register, /login, /app and /product-information on the preview URL. Verify SPA/API routing, static content, noindex and no caching of authenticated responses.
- Leave backend origin unset: landing remains interactive and account routes show coming soon. Save an explicit synthetic opt-in; verify exactly one row in relay_interest with the correct source/consent version and no password.
- Deny the intake connection: there must be no saved promise. Restore it and explicitly retry the same request. Test accepted-response loss and concurrent replay against actual PostgreSQL.
- Connect the backend and verify real account creation, invalid credentials, login/logout, secure cookies and backend Origin checks through the frontend domain. A 400/401/409/429 account rejection must not become a coming-soon success.
- Stop the backend and exercise initial session check, account submission and onboarding refresh. Verify bounded fallback and no automatic POST replay.
- Verify writer privileges, RLS, network/TLS, request bounds, edge rate controls, logs, record review and actual purge. Test keyboard, screen reader and phone layouts.

There is no live Vercel/PostgreSQL result or automated outbound notification evidence yet. Do not promise launch dates or access merely because interest was saved.
