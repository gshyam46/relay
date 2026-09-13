# L1-04 Inbound and Provider Restriction Evidence

Product: **AI Lead Intelligence & Outbound Automation**.
Date: **2026-09-11**.
Status: historical L1-04 local regression evidence; PostgreSQL and live-provider/human gates remain open. The subsequent [L1-05 callback slice](L1-05-callbacks.md) supersedes the old latest-attempt behavior, receipt-before-core-effects limitation and 100-character event-ID cap described below.

## Completed

Inbound processing now gives an explicit local opt-out priority over a supplied positive label or an optional model classifier. The receipt retains its canonical lead/channel/message identity. An incompatible repeated ID is rejected before restriction effects; compatible retry repairs an interrupted restriction even if the receipt already exists.

General opt-out writes the lead/current-contact restrictions and any recorded original sender contact atomically through ContactPolicyService. Restrictions commit before ancillary conversation/follow-up work or publishing a new inbound lead's LeadCreated event. A message-storage failure cannot undo the restriction. The original supplied sender is retained as normalized _ingress_contact inside the receipt payload, so a compatible replay can still restrict the actual old sender after a lead-address edit.

Inbound message identity includes provider and provider event ID through a bounded hash. Compatible older message records are reused rather than duplicated. Receipt insertion uses the existing database unique constraint with conflict-safe insertion and rechecks the canonical record.

Delivery no longer writes lead status ACTIVE. Ordinary reply updates use the repository's conservative status guard; durable contact policy remains authoritative across duplicate contacts. Creating a due human review or no-response follow-up checks restriction and creates the record in one workspace transaction, preventing a late callback from recreating restricted outreach work.

SendGrid normalization supports the documented top-level action argument and the prior nested fixture form, rejects conflicting references, and checks existing referenced action ownership/type before effects. Unsubscribe, group unsubscribe, complaint and explicitly permanent hard bounce apply an EMAIL restriction to the actual event recipient. Restriction events work without action metadata and with an obsolete reference that no longer exists. A stale reference does not discard the authenticated recipient restriction; no callback/action mutation is attempted without a resolved action. Known foreign action references still fail before effects with the same generic ownership error. Temporary blocked delivery, an unclassified bounce and ordinary dropped events do not invent permanent revocation. Resubscribe tracking cannot clear existing restrictions.

Provider restriction writes happen before ancillary delivery/audit handling. Unexpected storage failures propagate so the API can return a retryable response; successful replay reports the existing restriction. API request signing, body limits, per-event response classification and wiring are root-owned integration work.

## SendGrid setup UI

The email channel settings now show separate SendGrid-only Event Webhook and Inbound Parse verification public-key textareas. They persist through the existing channel_email settings API using sendgrid_events_public_key and sendgrid_inbound_public_key. SPKI PEM and base64 DER public keys are described; private keys are not requested. Clearing a public-key field explicitly saves an empty value so stale configuration is not silently retained.

Setup text explains that the URL token identifies the workspace, while a verified provider signature authenticates the callback. Selecting a provider or saving settings no longer claims a connected/verified channel. Stored channel settings load before the form initializes; workspace changes reset the form, and load/save failures are visible. Labels and descriptions are associated with the new multiline inputs. The existing generic settings hook contract is unchanged.

## Captured outbound message boundary

recordOutboundExecutionAttempt now consumes approvedDispatch, whose envelope contains the exact reviewed subject/body/recipient/sender. It does not render a new customer message from mutable payload or load current sender settings. The provider_config credentials remain in memory and are never copied into channel-message metadata.

SEND records require the captured envelope to match workspace, action, type and channel, and reference a persisted execution belonging to that action. Stored metadata includes prepared revision, envelope hash, exact recipient/sender and schedule.

Message creation reads the current persisted execution under the workspace gate. Callback message updates use the same gate. Consequently, a callback arriving before, after or concurrently with message recording determines the recorded delivery state even when the executor supplied an older STARTED object. This is a narrow ordering fix; it does not complete the durable callback inbox or exact-attempt correlation design.

## Files and contracts

- [channelWorkflowService.js](../../src/modules/channels/channelWorkflowService.js): contactPolicyService dependency, canonical receipt/replay, local opt-out precedence, sender provenance, restricted follow-ups and exact captured outbound recording.
- [inboundEventsRepository.js](../../src/modules/channels/inboundEventsRepository.js): atomic receipt insertion and same-event identity/content checks.
- [callbacksService.js](../../src/modules/outbound-automation/callbacksService.js): delivery no longer reactivates lead lifecycle.
- [sendgridEvents.js](../../src/modules/channels/sendgridEvents.js): exported normalizeSendgridEvent(event) and applySendgridEvent(services, organizationId, event).
- [settings.tsx](../../client/src/pages/settings.tsx): SendGrid verification setup and truthful configuration status.
- [inbound-contact-policy.test.js](../../test/inbound-contact-policy.test.js): focused policy/replay/provider/message-order regressions.
- [channel-workflow.test.js](../../test/channel-workflow.test.js) and [email-webhooks.test.js](../../test/email-webhooks.test.js): existing positive send journeys explicitly review/approve before execution; negative authorization assertions preserved.

SendGrid sg_event_id is required and bounded to 100 characters; missing IDs are input failures, with no guessed fallback event identity. Expected malformed/foreign-reference errors have statusCode 400/404; conflicting inbound receipts return 409; unavailable policy returns 503; unexpected persistence failures are not swallowed.

The provider helper requires caller-verified original request bytes and a trusted workspace. Neither an action argument nor a URL token alone proves provider authenticity. It never performs signature verification itself.

No independent schema migration is owned by this slice. Contact storage/legacy backfill and prepared review records belong to the coordinating agents under the [shared contract](../L1-04_L1-08_DISPATCH.md).

## Verification

~~~powershell
node scripts/run-tests.js test/inbound-contact-policy.test.js test/channel-workflow.test.js test/email-webhooks.test.js
~~~

**35 tests passed, zero failed or skipped** in this local run: 20 new focused tests, eight channel-workflow tests and seven email-webhook tests. Scoped JavaScript syntax checks passed. This is synthetic SQLite evidence, including file-backed restart coverage from the existing channel suite.

The tests prove:

- Local opt-out overrides supplied classification without a model call; matching duplicate contacts stop while another workspace remains unaffected.
- Failure after receipt but before restriction can be repaired from canonical state; failure after restriction but before message persistence retains restriction and repairs one message.
- Changed lead, sender, channel or message body cannot reuse a receipt identity; equal IDs from different providers create distinct messages; competing receipt inserts select one canonical row.
- A captured original sender remains restricted across lead edits; new opt-out leads are restricted before their creation event is published.
- Later ordinary replies and delivery cannot clear restriction or create new follow-ups.
- Stored customer copy matches the captured envelope and excludes provider credentials; missing or mismatched envelopes fail.
- Provider normalization handles real top-level metadata, legacy fixtures, no-action and obsolete-action recipient restrictions, actual old recipients, tenant conflicts, permanent/temporary bounce distinction, duplicate restriction, resubscribe non-release and storage failure propagation.
- Callback-before-message, message-before-callback and concurrent ordering all retain DELIVERED message state despite a stale execution object.

Client validation passed with the installed local tools from client: node node_modules/typescript/bin/tsc -b and node node_modules/vite/bin/vite.js build. Vite still reports the existing large main bundle warning (approximately 851 kB minified / 240 kB gzip); route splitting is a separate planned task. This is type/build evidence, not browser or real-provider QA.

The old positive send fixtures now explicitly call the test client's review/approve sequence. This updates their setup to the new product contract; it does not bypass approval automatically or remove negative tests.

## Remaining limits and human QA

The full L1-07 durable inbox/replay cursor and exact provider-attempt correlation remain unfinished. Existing callback receipt-before-effects behavior can still leave ancillary callback processing incomplete after a crash; callback updates still correlate via the current action attempt. Inbound intelligence/event/follow-up effects beyond the restriction and repaired message are not a complete resumable pipeline. These limits must remain visible in task/release records.

The existing local opt-out phrases are a conservative deterministic gate, not complete multilingual intent understanding. Broader language/quoted-message evaluation remains required. Historical receipts lacking captured sender contact cannot reconstruct an old address after it has changed; ambiguous legacy attribution requires review.

Local tests do not establish real PostgreSQL policy ordering, actual SendGrid signing/configuration, real deliveries/replies, or customer usefulness. Provider signature/tamper tests, atomic dispatch and prepared approval tests are separate coordinating slices and must be included in the integrated release evidence.

Human QA must check that the two public-key fields appear only for SendGrid, preserve multiline content after save/reload, clear when saved empty, reset on workspace switch, and display useful loading/error states. Confirm that sandbox/other provider forms remain usable and selection is never presented as verified connectivity.

Human QA must demonstrate an opt-out across existing/new duplicate records and queued work, later reply/delivery without reactivation, actual event-recipient suppression after an address change, and a controlled provider failure/retry. Verify signed real-provider events using authorized test recipients before live-customer use. No real messages, provider-account changes, customer database writes or deployments occurred in this slice.

Primary provider contracts consulted: [Event Webhook reference](https://www.twilio.com/docs/sendgrid/for-developers/tracking-events/event) and [Inbound Parse security](https://www.twilio.com/docs/sendgrid/for-developers/parsing-email/securing-your-parse-webhooks).
