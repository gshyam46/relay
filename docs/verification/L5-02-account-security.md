# L5-02 account-security verification

Recorded: 2026-09-13. Scope: owned authentication and account-security modules under [the accepted contract](../L5-02_ACCOUNT_SECURITY.md). This is local synthetic verification. It does not certify deployed PostgreSQL, human recovery, managed email or operator identity verification.

## Implemented

Owners can confirm their current password to change it, rotate eight offline recovery codes, revoke an individual session, revoke other sessions or revoke all sessions. Exact security revisions guard concurrent commands. Password changes and recovery revoke every session and require fresh login. Revoke-others advances authentication authority while retaining the current session. Existing registration, role and cookie behavior is preserved.

Offline recovery codes contain independent 256-bit randomness. Only SHA256 hashes and usage/expiry markers persist. Plaintext appears once in the successful rotation result, never in history, inspection, audit or a recovery endpoint. Each code is single-use for365 days and invalidated by a later rotation. Unused codes survive another code's use or ordinary password change until use, expiry or rotation. Unknown accounts, unavailable codes and racing redemption share a generic rejection.

Credential verification and hashing stay outside workspace transactions. Login now rechecks its originally verified hash, workspace and authentication revision under the same gate used by password/reset/revoke-all commands. A reset that wins that gate prevents an older password verification from creating a valid session afterward. The authentication revision also rejects a stale session row reintroduced without current authority.

Session inspection exposes opaque public references, never bearer IDs. New login caps active sessions at100 and prunes at most200 expired session records. Scoped account history is append-only, bounded at1000 changes and paged at20/default50/max. Credential/code/session mutations, security state and audit commit together; failure rolls them back together.

## Automated evidence

Initial existing regression command:

```text
node scripts/run-tests.js test/auth.test.js test/auth-boundaries.test.js test/auth-admission.test.js
```

Result: **29 total, 28 passed, 1 explicit PostgreSQL skip, 0 failed**. Existing registration, login, dummy password verification, hash/input limits, scoped session validation, secure cookie behavior, durable auth admission and rollback remained green.

Combined initial security run:

```text
node scripts/run-tests.js test/l502-account-security.test.js test/auth.test.js test/auth-boundaries.test.js test/auth-admission.test.js
```

Result: **47 total, 46 passed, 1 explicit PostgreSQL skip, 0 failed**. This included the first18 new account-security cases.

Final focused run after adding rotation rollback and history-cap coverage:

```text
node scripts/run-tests.js test/l502-account-security.test.js
```

Result: **20 passed, 0 failed, 0 skipped**. Tests cover read-only and secret-free inspection; code shape/uniqueness/one-time projection; strict fields, passwords and owner/session/tenant scope; password/reset session invalidation; exactly one winning concurrent redemption or rotation; expiry and old-code rejection; reset/recovery/rotation audit rollback; individual/other/all revocation; stale-password and revoke-other login races; stale authentication epochs; active-session capacity; safe history pagination/corruption refusal; preserved existing role behavior; and the supported history limit.

Final combined run after refining an incorrect current password to HTTP403:

```text
node scripts/run-tests.js test/l502-account-security.test.js test/auth.test.js test/auth-boundaries.test.js test/auth-admission.test.js
```

Result: **49 total, 48 passed, 1 explicit PostgreSQL skip, 0 failed**. The incorrect-password regression verifies that the authenticated session remains valid. Expired/revoked session authority and public recovery rejection retain HTTP401.

The safe launcher used disposable SQLite, removed inherited database/provider configuration and performed no live provider/model calls. Source checks confirm public session references match the frozen migration backfill. Owned diff whitespace checks passed. No temporary fixture or running server was created for this slice.

## Remaining acceptance

Root owns migration0019/API admission/cookie clearing, frontend integration and integrated verification. Human QA must save codes, redeem one while signed out, observe revoked browsers, rotate codes and recover from a lost response. Lost rotation plaintext cannot be fetched again; owners explicitly rotate a new set. Lost password-change responses resolve through login with the new password.

The account needs a correct server UTC clock. Actual PostgreSQL concurrency, populated upgrade/restore, session/code reconciliation after restore and host/cookie behavior remain external gates. Recovery does not recall requests already authenticated or committed actions/provider sends. A user who loses both password and all usable codes needs separately verified operator recovery; no identity bypass or fake recovery email is implemented. Multi-user invitation/permissions and account disable remain outside this single-owner slice.

## Owned files

src/modules/auth/accountSecurityContract.js, accountSecurityRepository.js and accountSecurityService.js; narrow authService.js/authRepository.js integration; test/l502-account-security.test.js; the account-security contract and this evidence. Existing global API, migration registry, configuration, logger and frontend files remain owned by root.
