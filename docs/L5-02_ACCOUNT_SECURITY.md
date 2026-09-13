# L5-02 single-owner account security

Status: accepted local implementation contract, 2026-09-13, under [ADR-023](DECISIONS.md#adr-023---complete-customer-workflow-with-shared-authority-and-a-public-boundary) and the [completion plan](COMPLETION_PLAN.md). Root owns migration0019, API/config/logger and client wiring; review owns auth/account-security modules, focused tests and evidence. Existing registration, login and role behavior remain supported. No email provider, account disable, team invitation or new identity service is introduced.

## Authority and records

users.auth_revision and sessions.auth_revision default to0. Password change, recovery and revoke-all increase the user's authentication revision and delete its sessions. Revoke-other-sessions also advances that revision but rebinds the retained current session. Login verifies its captured password outside a transaction, then rechecks the exact current hash, workspace and auth revision under the workspace gate before issuing a session. A reset that wins that gate prevents stale-password login from committing. Authenticated requests already admitted before revocation may complete; revocation is not a recall of committed actions or provider requests.

sessions.public_id is sref_ plus SHA256 of the random bearer session ID. Migration0019 backfills it in bounded pages. Public inspection and revocation use that reference; neither a raw bearer ID nor session cookie is exposed. New login admits at most100 active sessions per account and opportunistically prunes at most200 expired records. Existing malformed session timestamps remain unauthenticated.

account_security_state stores same-workspace user, security revision, recovery generation and update time. Revision0 has neutral defaults until a security mutation. account_recovery_codes stores random code IDs, same-workspace user/generation, high-entropy code hashes, created/expiry times and consumed/revoked markers. account_security_changes stores immutable scoped revision/expected revision, operation, authentication method, safe summary and actor/time. No password, recovery-code plaintext or password-derived request hash enters history. Security history is capped at1000 changes and pages at20/default50/max.

## Commands

GET /api/auth/security returns security_revision, auth_revision, recovery {generation,usable_count,expires_at}, at most100 sessions {public_id,created_at,expires_at,current}, session_limit and paged history. GET /api/auth/security/history accepts before_revision and limit. The session and workspace are server-derived.

POST endpoints below require current_password and expected_security_revision:

- /api/auth/security/password additionally takes new_password.
- /api/auth/security/recovery-codes rotates the offline recovery set.
- /api/auth/security/sessions/:public_id/revoke revokes that same-account session.
- /api/auth/security/sessions/revoke-others preserves only the authenticated current session.
- /api/auth/security/sessions/revoke-all signs out every session, including the caller.

The service methods are get, history, changePassword, rotateRecoveryCodes, revokeSession, revokeOtherSessions and revokeAllSessions. Internal scope is {organization_id,actor,session_id}; the bearer session_id is never accepted from client JSON. Mutations return {change,sign_in_required,recovery_codes?}. Public change includes id, revision, operation, authentication_method, revoked_session_count, recovery_generation, recovery_codes_issued, recovery_expires_at, session_public_id, created_at and actor_user_id.

Expected security revision prevents concurrent commands or repeated old intent from silently executing twice. Secrets are not hashed into an idempotency ledger. After an uncertain password-change response, sign in with the new password to establish the result. A lost recovery-code display cannot be fetched again: the signed-in owner explicitly rotates again with the current password and latest revision. No server-side recoverable code copy is retained.

## Offline recovery

Rotation generates eight independent 256-bit codes and returns their plaintext once. Each is valid for365 days from issuance, single-use, and invalidated by later rotation. Unused codes survive ordinary password changes and use of another code until consumption, rotation or expiry. Public POST /api/auth/recover takes exactly email, recovery_code and new_password. It atomically consumes an available matching code, changes the password, advances auth/security revisions, revokes all sessions and records RECOVERY_CODE authentication. It returns sign_in_required=true without issuing a new session. Unknown accounts, bad codes, expired/revoked/used codes and racing redemption return the same generic rejection.

Password verification and hashing run outside database transactions. All password-bearing routes reuse bounded LOGIN peer/account/global admission and the existing maximum two password-work slots; authenticated routes derive the account identity from the session. Body limits are16KiB. A mistyped current password returns403 AUTH_PASSWORD_REJECTED and preserves the valid session; expired/revoked session authority remains401. Current-password/new-password/code values cannot appear in normal errors, public history or logs. Rate budgets and safe generic rejection do not assert timing-proof authentication.

## Acceptance and limits

Focused tests must cover secret-free inspection/history, own-session references, tenant/actor/session checks, exact revision conflicts, incorrect passwords, code rotation/expiry/one-use/races, audit-failure rollback, all/other/current revocation, stale-password login races, unchanged roles and existing auth/cookie/admission regressions. No provider calls are necessary.

Human QA must save codes safely, redeem one from a signed-out browser, verify prior sessions stop authenticating, rotate codes and handle a lost response. Codes must be prepared while account access still exists. Losing both password and all usable codes needs separately verified operator recovery; there is no identity-proof bypass. The service relies on a correct server UTC clock; production clock, PostgreSQL concurrency/restore and operator identity verification remain external acceptance. Database restore must reconcile revoked sessions and consumed codes before resuming access. Single-owner scope defers collaboration only; sharing credentials is unsupported.
