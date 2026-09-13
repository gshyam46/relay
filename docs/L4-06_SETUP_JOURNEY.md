# L4-06 guided setup and public product information

Recorded 2026-09-13 before source changes under the [completion authorization](COMPLETION_PLAN.md). This is a bounded first-owner guide, not a workspace completion score or launch gate. Existing business, intelligence, channel, approval and customer-workflow domains retain authority.

## Read contract

Owner-only `GET /api/setup-journey` derives workspace and actor from the session. `SetupJourneyService.get({organization_id,actor})` returns:

```text
{version:1, assessed_at, scope:'LATEST_ACTIVE_ENQUIRY',
 lead:null|{id,name},
 steps:[{id, state, reason_code, details}]}
```

The seven ordered IDs are BUSINESS, ENQUIRY, INTELLIGENCE, CHANNEL, RECOVERY, REVIEW and WORKFLOW. State is RECORDED, NEEDS_ATTENTION, NOT_STARTED or UNAVAILABLE. Details are small allowlisted metadata; source text, messages, provider keys, routing tokens, recovery codes, model context and histories are excluded. Step read failures become UNAVAILABLE with a finite reason; authentication failures reject the request. The latest active, non-verification-probe enquiry is selected by created_at and id descending, not by fit or inferred priority. Its name is capped at 200 characters. No automatic selection claims a workspace-wide result.

| Step | Bounded persisted observation |
| --- | --- |
| BUSINESS | Latest validated profile revision, required name/offering presence and typed criteria configuration. A missing typed criterion remains a separate setup task. |
| ENQUIRY | Selected active enquiry ID and source. Import/correction links remain the ordinary data workflow. |
| INTELLIGENCE | Latest saved snapshot ID, status and creation time. `currentness:'NOT_CHECKED'`; the ordinary Intelligence/detail screen evaluates currentness. Merely reading this guide does not advance the technical freshness clock. |
| CHANNEL | Structurally checked current provider/configuration. `verification_status:'NOT_CHECKED'` and `live_send_available:false` here are conservative; the channel panel remains the authoritative verification/dispatch surface. No network check or routing provisioning occurs. |
| RECOVERY | Current owner's validated recovery generation, unconsumed/unrevoked/unexpired code count and expiry. Having codes does not prove they were saved offline. |
| REVIEW | Latest EMAIL action, its actual current revision and any decision attached to that exact revision. A recorded decision is historical metadata and does not establish current approval, due time, contact permission or sending capability. |
| WORKFLOW | Selected enquiry's canonical inbound count, effective conversation/read/attention state, first pending reminder, and up to three current outcome descriptors with explicit truncation. Withdrawn outcomes do not count as recorded milestones. |

All observations are database reads under the workspace boundary. There are no analysis/provider invocations, task/approval creation, completion mutations, fake client checkboxes or local-storage completion state. The guide has an explicit GET refresh and links into existing work screens. It must retain missing/unavailable/needs-attention states rather than turn them into zero or a completed step. The enquiry-specific observations refer to one selected enquiry, not necessarily a representative customer case.

Profile JSON is byte-preflighted before validation. Metadata reads use fixed row limits and project only required columns. Current workflow services/repositories may supply bounded state; historical message bodies and full outcome histories are not requested.

## Public product information

`/product-information` is a public named `ProductInformationPage`, independent of session or API availability. It states the product identity and current internal/Sandbox scope; pilot form collection (name, email, company, workflow, channel, consent plus request/admission metadata); separate storage from customer leads; saved-for-review rather than accepted-pilot semantics; and no automatic email promise. Do not send customer records or secrets through the public form.

The 90-day pilot-interest retention is a declared operational policy until the integrating owner's purge implementation and schedule are verified; copy must not claim deletion already happens automatically. Identity of the responsible operator, privacy request contact, support contact and actual support hours are explicitly unpublished before public release. Do not invent a legal entity, address, response SLA or tracking claim. The page distinguishes the public form from authenticated workspace records and provider-dependent data processing. Public links point here from the landing footer/form; no fictitious policy/support URL is used.

## Ownership and acceptance

UI owner owns `setupJourneyService.js`, its focused service test, `setup-journey.tsx`, `product-information.tsx`, narrow marketing links, focused browser fixture/verifier and evidence. Root owns API/factory/route/static metadata wiring and global task status. No migration or shared freshness/approval policy changes are introduced by this guide.

Automated acceptance: owner/tenant isolation; empty workspace; archived and verification-probe exclusion; precise profile and recovery evidence; latest exact revision review; withdrawn outcomes; scoped unavailable reads; no persistent mutations or external calls; actual React links/GET refresh/empty/error states; public information API independence; keyboard and narrow layout. Synthetic browser fixtures do not close the 100-enquiry target-customer walkthrough, full screen-reader/zoom acceptance, provider verification or production privacy/support operational gates.

## Responsive shell refinement

The actual 390-pixel browser journey found the historical fixed 240-pixel sidebar consuming most of the screen. The integrating owner approved reopening the shared app-shell/sidebar and narrow header layout before implementation. Below 768 CSS pixels, navigation uses an explicit modal drawer with a labeled trigger, close button, Escape, focus containment/restoration and close-on-navigation. Resizing back to desktop closes the drawer. The desktop collapse preference remains separate. Header actions wrap; the guide and normal content receive the available mobile width. No route, domain or permission change is introduced. The browser regression retains the actual narrow layout assertion and adds keyboard drawer behavior.
