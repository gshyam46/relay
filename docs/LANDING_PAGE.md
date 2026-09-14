# Interactive Product Landing Page

Product: **AI Lead Intelligence & Outbound Automation**.
Planning date: **2026-09-11**. Implementation review: **2026-09-13**.
Status: **Implemented as a local product preview with a public route, interactive synthetic example, real Sandbox registration and persisted pilot-interest intake. Public publication and customer/provider acceptance remain separate release gates.**

## Why this is part of the product

The user has explicitly asked for an ambitious, modern, interactive landing page. It is part of the implementation plan, with its own customer, design, engineering, and release acceptance. Its purpose is to help the right business recognize its problem, understand the product's value, experience the core workflow, and take a meaningful next step.

The page should answer: "I already have leads. Which ones need attention, why, and what should my team do next?" Lead Intelligence gets the primary story and screen space. Outbound Automation shows how a reviewed decision becomes action and how the response changes what happens next. Lead Discovery remains optional.

The current authorized completion batch implements the L4 customer journey and L5 operational controls around the existing L2/L3 intelligence contracts. The landing preview is implemented alongside that work. Public publication still follows the L6 release decision; visual completion does not close customer-value, provider, privacy or operating gates.

Authority: [PRODUCT.md](PRODUCT.md), [ROADMAP.md](ROADMAP.md), [TASKS.md](TASKS.md), [PILOT.md](PILOT.md), and [TESTING.md](TESTING.md). L4-07 and L5-07 are the delivery tasks; their authoritative status belongs in TASKS.md.

## Implemented frontend and evidence

- [App.tsx](../client/src/App.tsx) separates public, authentication and protected route boundaries. The public page does not wait for useMe or load workspace data.
- [LandingPage.tsx](../client/src/marketing/LandingPage.tsx), [LandingDemo.tsx](../client/src/marketing/LandingDemo.tsx), [typed fixtures](../client/src/marketing/demo-fixtures.ts) and scoped [landing styles](../client/src/marketing/landing.css) implement the page and deterministic example. The protected application and interactive walkthrough remain separate chunks. The walkthrough now mounts automatically when the landing page renders; visitors do not need an activation click.
- [AuthPage](../client/src/pages/auth.tsx) serves explicit /login and /register routes using the existing cookie/session endpoints. Registration creates a Sandbox workspace; it is not admission to live service.
- The protected dashboard is /app. Existing /leads, /intelligence, /outbound, /conversations, /activity, /settings and their supported deep links remain protected at their existing paths.
- [Initial HTML](../client/index.html) contains product identity, headline, explanation and working links. The Node static-serving boundary distinguishes public, auth and private HTML, API routes, canonical metadata and noindex behavior. Deployment-specific domain/indexing acceptance is still required.
- [Product information](../client/src/pages/product-information.tsx) at /product-information states the actual preview, pilot collection and retention boundaries and visibly identifies unpublished operator privacy/support contacts. It does not invent a legal entity, support address or SLA.
- [Landing browser evidence](verification/L4-07-ui.md) records the historical 21-check checkpoint; [loading and CTA evidence](verification/LANDING_LOADING.md) records the latest 27 passing checks; [setup/mobile evidence](verification/L4-06-ui.md) records the subsequent public-information and shared navigation work. These are local synthetic verification checkpoints, not publication approval.

Relay is the retained display wordmark and is paired prominently with **AI Lead Intelligence & Outbound Automation**. Confirm the public display-name decision before release; the mandated product identity remains unchanged.

## Audience, story and page structure

The first segment, buying trigger and primary channel remain unvalidated. Develop one coherent story over existing customer-owned enquiries; adapt its details after the PILOT discovery decision. Do not market to six industries at once or imply every channel is ready.

Implemented headline: **"Your next move, backed by what you know."** Its effectiveness for the first customer segment still needs comprehension testing.

Supporting story: turn scattered enquiry records into explained priorities, review the next action, and use replies and outcomes to decide what follows. The preview qualifies its synthetic behavior and open live-channel/customer acceptance. Public wording must continue to match verified capabilities and supported customer scope.

| Section | Visitor question | Required content and interaction |
| --- | --- | --- |
| Navigation | What is this, and how do I explore it? | Product identity, How it works, Try it out, Get started, Sign in; compact mobile menu |
| Hero | Is this for a problem I have? | One outcome-oriented headline, specific existing-enquiry problem, visible product identity, Try it out CTA and Get started linking to registration |
| Interactive example | What changes when I use it? | A realistic synthetic queue that becomes evidence-backed intelligence, a reviewed action, a response and an updated next step |
| Problem and workflow | Where does it fit into my day? | Import existing records, understand priority, act with review, handle replies, record progress; show what the human still owns |
| Intelligence and control | Why should I trust a recommendation? | Evidence drilldown, unknown/stale facts, eligibility independent of priority, editing and review; link actual supported data/use boundaries |
| Outcome and fit | What should improve, and for whom? | Selected workflow, customer responsibilities, observable progress and available outcome/export behavior; measured proof only when available |
| Getting started | What would adoption require? | Real onboarding steps, required data, chosen channel, setup effort learned from pilots, support model and limits |
| Questions and close | What remains uncertain? | Plain answers on own data, review, supported channel, existing tools, data handling, price/pilot terms; final CTA with a working destination |

Keep one main narrative. Avoid a wall of feature cards, unearned logo strips, invented testimonials, fake live activity, countdown scarcity, or AI jargon as the value proposition.

## Signature interaction: one lead, a changing decision

The visual centerpiece is a guided interactive product example, not an autoplay video or a simulated live backend. It should be satisfying to explore in under two minutes and understandable without interacting.

Persistent label: **"Interactive example - synthetic data. No messages are sent."** A separate visible product-preview label identifies behavior still under development. Do not use a green Live badge, generated customer names presented as real users, or production-looking delivery notifications without the example label.

Use a small typed, deterministic fixture set with three contrasting enquiries: relevant but missing a detail, relevant with a recorded follow-up request, and restricted from contact. Use reserved example addresses if contact details must appear. No visitor data, uploads, real business records, LLM calls, provider calls or credentials are needed.

| Step | Visitor interaction | What visibly changes | What the example teaches |
| --- | --- | --- | --- |
| 1. Source | Select one of three sample records | Original enquiry excerpt, its example source/date, known fields and unknowns appear | A contact record alone does not prove intent |
| 2. Intelligence | Select a supported criterion or open Why this lead? | Explained priority and matching source excerpts appear; missing or conflicting information remains visible | Priority is business-specific and evidence-backed |
| 3. Decision | Compare Ask a question, Follow up and Do not contact where applicable | Suggested next action and eligibility reason change with the example state | Best action can be gather information, wait or stop |
| 4. Review | Inspect recipient, evidence-backed draft and approval step | Draft edits mark the example as requiring renewed review; an explicit Simulate reviewed action advances it | Human review is meaningful; the reviewed version matters |
| 5. Response | Choose a synthetic reply, no response or opt-out event | Timeline updates; opt-out blocks future outreach; a genuine question creates human work | Delivery, reply and contact permission are different facts |
| 6. Outcome | Record a sample meeting request or follow-up outcome | Outcome and revised next step appear with a recorded-by-human label | A message is not a sale; feedback changes intelligence |

Include a Reset example control and a stable URL fragment for the example section. Sample dates and relative labels must agree; avoid a fixed old date described as "today." Switching records resets dependent draft/reply state or explains the retained state.

The fixture reducer is a presentation example, not a second implementation of send policy. It uses reviewed expected outputs derived from versioned product contracts. Contract changes must trigger a fixture/story review. Public demo transitions must not imply a guarantee that the live system cannot meet.

On desktop, use a legible workspace stage: source/queue rail, active intelligence canvas, and concise next-step panel. On small screens, show one panel at a time with numbered steps, persistent example labeling and explicit Next/Back controls. Do not shrink a desktop dashboard into unreadable phone-sized text.

## Visual direction

Use the user-approved ivory and ultramarine [design system](DESIGN_SYSTEM.md), superseding the earlier teal, pale green and navy palette. The design should feel precise, confident and alive: large editorial typography, generous space, crisp boundaries, high-quality data typography, and a central interface that reveals information as the visitor explores.

The refined design uses a warm ivory editorial canvas, an ultramarine product accent and a light interactive stage. Keep the actual evidence, queue rows and action states the visual focus. Introduce one limited accent for a selected signal if needed; do not replace the palette with a generic rainbow or neon-purple template.

Use deliberate scene transitions: source text highlights into a claim, a selected claim connects to a reason, and an approved action enters the timeline. Motion should explain the state change. Use native CSS/SVG and existing icon primitives first. No animated particle background, scroll hijacking, automatic audio, cursor replacement or mandatory WebGL.

Keep copy density low in the hero, with readable evidence and detail available on demand. Avoid embedding critical text inside images. Synthetic interfaces should use real text and semantic controls. Original illustration can be added later if it serves the story; stock robot imagery is not the concept.

## Public-route and bundle architecture

The implementation retains React/Vite and the Node API. ADR-023 in [DECISIONS.md](DECISIONS.md) and [COMPLETION_PLAN.md](COMPLETION_PLAN.md) record the approved public boundary and minimal route migration. No new framework, microservice or authentication provider was introduced.

| Implemented destination | Current behavior | Remaining release condition |
| --- | --- | --- |
| / | Public landing page without a blocking session/workspace query | Real deployment, domain, indexing and copy acceptance |
| /#example | Deterministic synthetic example with a readable fallback; no application writes | Target-user comprehension and full human accessibility review |
| /login | Existing sign-in form; safe internal return destination | Production access and recovery acceptance |
| /register | Existing Sandbox workspace creation | Explicit release access policy; no implication of live-channel permission |
| /app | Protected dashboard | Existing authorization and expired-session behavior remain mandatory |
| /leads, /intelligence, /outbound, /conversations, /activity, /settings and existing deep links | Protected work routes remain at their previous paths | Continued bookmark, back/forward and direct-refresh regression checks |
| /#pilot | Working persisted pilot-interest form | Accountable triage owner and operational response/retention acceptance |
| /product-information | Public preview/privacy/support information and meaningful initial HTML | Publish actual operator contacts and approved policies before public launch |

Only the dashboard moved from / to /app. The earlier proposal to prefix every protected path with /app was superseded by ADR-023; existing work links are preserved without a blanket redirect migration. The landing includes an Open workspace link. Auth and private direct requests do not inherit indexable marketing content. Server authorization remains the security boundary.

Use one router above separate public/authenticated layouts. Lazy-load the protected shell/pages and the heavier interactive example. Public visitors should not download lead tables, dashboard charts, workspace stores or every application page merely to read the hero. Marketing must remain readable if session lookup fails; an optional authenticated CTA enhancement cannot block page rendering.

The initial public document contains the main identity, headline, explanation and links without requiring React to explain the product. React enhances it with the page and automatically mounted lazy walkthrough. Shared branded loading screens cover pending page and walkthrough chunks; failures retain the readable fallback. Route-specific Node static serving keeps API responses outside the HTML fallback; no SSR infrastructure was added.

Give the public document its own title/description, canonical URL for the actual domain and share preview. Ensure private/auth routes do not inherit indexable marketing content on direct requests. Private API authorization remains mandatory; noindex is only a search directive. Verify route-specific static serving, cache policy and deployment fallback behavior.

## CTA behavior and honest conversion

Try it out links to the already displayed walkthrough at /#example. Get started opens /register using the existing Sandbox registration flow; Sign in opens /login. Book a demo and Reach out appear in the final contact section and footer, and both open the existing persisted request form at #pilot, as requested by the user. The form heading is Book a demo or reach out; Send request saves an enquiry for review. A demo time is confirmed separately. These controls do not claim a confirmed booking or live delivery access.

For a supervised pilot, choose a qualified request flow or an actual verified founder contact destination. A request flow needs owned persistence or a tested receiving integration, clear success/failure states, abuse limits, duplicate handling, a response owner and a disclosed data purpose. Collect only the minimum contact/business information needed to qualify fit. It must never display Submitted after only setting local React state.

POST /api/public/pilot-requests accepts request_key, name, email, company, workflow, channel (EMAIL, WHATSAPP or UNDECIDED), explicit consent:true and an empty website honeypot. Interest is stored separately from customer leads with bounded request/admission handling and idempotent exact retry. HTTP202 confirms only that the request is saved for review. The UI distinguishes invalid input (400), conflicting request identity (409), rate limiting (429), and unavailable/unknown outcome (503); it retains the exact pending request for an explicit retry. No booking, notification, accepted pilot or sending capability is claimed. [Pilot operations](../scripts/pilot-interest.js) provides deliberate local triage/retention tooling; assigning and verifying its operating owner remains a publication gate. Do not invent a calendar, support email or delivery promise.

After customer evidence and L6 approval, the CTA can become the supported onboarding/pricing flow. Pricing, trial terms, cancellation and usage limits must reflect actual operational behavior. "Start free" cannot be used merely because a registration form exists.

## Proof, privacy and measurement

Create a small copy/evidence checklist alongside implementation. Each material published claim has wording, evidence link, owner, supported segment/channel, verification date and review trigger. Label concepts as preview in private demonstrations and remove or qualify claims unsupported by the release candidate.

Do not publish accuracy, time saved, customer counts, conversion uplift, uptime, security certification, unlimited scale or connector availability without corresponding evidence. Use real provider names only for capabilities actually verified and supported. L6 pilot results must retain cohort, time window and measurement limitations. Get permission for customer names, quotes, logos and screenshots; synthetic examples never supply social proof.

Measure the funnel from page visit to example engagement, qualified request, accepted pilot and actual activation. Proposed events: example_started, evidence_opened, example_completed, primary_cta_clicked and request_accepted. A local button click is not a qualified lead or signup. Define denominators, bot/internal filtering and deduplication before reporting conversion.

Analytics is optional to the prototype. Any production analytics uses an agreed privacy/consent design and minimal event fields. Do not send enquiry contents, typed form values, email addresses, session identifiers or real lead IDs to marketing analytics. The example works with analytics blocked.

## Quality budgets and acceptance

The following remain release targets, not customer commitments or a claim that every target is measured. Local browser evidence records keyboard interactions, synthetic-state boundaries, 360px layout, reduced-motion behavior, API/lazy-load failure and a historical public initial JavaScript checkpoint of 103,241 gzip bytes (excluding deferred demo/protected code). The latest [loading/CTA build](verification/LANDING_LOADING.md) measures 110,045 gzip bytes including the automatically loaded walkthrough, excluding protected pages. Full screen-reader/200% zoom/actual-phone acceptance and representative LCP, CLS and interaction-latency measurements remain open. Record device, browser, build, network/CPU conditions for publication evidence.

| Area | Acceptance |
| --- | --- |
| Accessibility | Semantic landmarks and heading order; labeled controls; visible focus; keyboard-only example/menu/dialog use; useful screen-reader state announcements; tested contrast; usable at 200% zoom |
| Motion | Honor prefers-reduced-motion; every state is reachable with animation disabled; pause/skip extended motion; no hover-only content or automatic scene advancement required to understand the story |
| Mobile | No horizontal overflow at 360 CSS pixels; usable touch controls; readable evidence; menu and step navigation work with screen keyboard and narrow viewports |
| Performance | Public initial JS budget <= 200 KiB gzip including the automatically mounted walkthrough and excluding protected app chunks; no dashboard/chart bundle in the public entry; explicit image dimensions, deferred below-fold media and font fallback |
| Responsiveness | Proposed LCP <= 2.5 seconds, CLS <= 0.1 and interaction latency <= 200 ms on the agreed representative mobile test profile; record lab evidence, then measure real-user results when available |
| SEO/share | Useful initial HTML, correct title/description/canonical/share image, indexable public page only when approved, staging noindex, route and sitemap policy verified on the deployed candidate |
| Reliability | Landing content survives API outage, blocked analytics and failed lazy demo load; failed example enhancement offers a readable static workflow; no secret or tenant content in static artifacts |
| Conversion | Every visible CTA has the claimed effect; backend error and duplicate submission shown honestly; successful request evidence reaches its operational owner |
| Content truth | Example labeling survives every step and mobile state; only supported product claims/channels; no mock metrics or made-up social proof |
| App compatibility | Existing work routes, login/logout, session expiry, deep links and protected API boundaries retain their behavior after route separation |

Keep a meaningful automated browser suite: navigate the example by keyboard, inspect evidence, edit/review the sample, apply opt-out and observe blocked next action, reset it, follow the real CTA, refresh a protected deep link and verify no domain/provider mutation from the public demo. Assert visible outcomes and network boundaries instead of screenshot-perfect incidental spacing.

Run an automated accessibility check and build/bundle checks, then manually review keyboard, screen reader, reduced motion, a midrange phone, slow loading and the actual production-shaped host. An engineer's visual approval does not replace target-user comprehension testing.

## Delivery history, ownership and release gates

| Slice | Dependencies | Deliverable and gate |
| --- | --- | --- |
| Original planning during L1 | Product review and explicit user request | Planning completed; first audience/channel and headline comprehension still need founder/customer evidence |
| L4-07 - Interactive prototype | L2-01 business-context and L3-01 intelligence contracts; reviewed story | Implemented public preview, deterministic example, actual login/register routes and local browser/mobile/reduced-motion evidence; human customer acceptance remains open |
| L5-07 - Production landing and funnel | L4-07; L4-06 journey; L5-02 access; L5-04 privacy responsibilities | Static content, persisted CTA and information page are implemented locally. Accountable pilot handling, operator contacts, full accessibility/performance and deployment acceptance remain release gates; analytics remains optional |
| L6 publication | L5-07 and L6-04 release decision | Final copy, pricing/support details and evidence match released scope; explicit public publication scope and release owner; no deployment occurs solely from this plan |

Root/integrating engineer owns router composition, app navigation changes, build/static serving and shared configuration. A frontend specialist can own landing-only components/styles and fixtures after route/fixture contracts are agreed. Product/founder owns audience, claims and CTA qualification. QA owns browser/accessibility/performance evidence. Operations owns real request delivery, domain/static serving and release checks.

Keep landing components, styles and fixtures in a scoped marketing area rather than spreading them through authenticated pages. Reuse primitive tokens/components where appropriate, while keeping marketing motion and layout from changing operator workflows.

Human QA must show that a target user can explain what the product does, identify the evidence behind a recommendation, recognize the synthetic example, understand their review responsibility and complete the advertised next step without guidance. Record confusion and revise the story before public release.

After every slice, update this specification, TASKS/ROADMAP, relevant PRODUCT/ARCHITECTURE/TESTING/DEPLOYMENT details, and a dated verification record. Keep proposed budgets, validated evidence, shipped behavior and future promises clearly separate.

## Current verification boundaries

Implementation evidence is linked above; TASKS.md owns closure status. No real customer testimonials, measured conversion uplift, hosted-model accuracy, unlimited scale or production/provider certification is supplied by the synthetic landing. The public route and real intake endpoint are implemented; public publication still requires the L6 release decision and the unresolved human/operational evidence.

## Independent frontend hosting

[VERCEL](VERCEL.md) prepares standalone public hosting and independent persisted acquisition. The walkthrough stays available without the application backend. Account entry points expose unavailable access and explicit update opt-in; both contact forms use the configured deployment intake store. Successful interest is separate from account creation, booking and live access. Actual Vercel/PG/operator acceptance remains required.

## Readability and visual affordances - 2026-09-15

The approved ivory/ultramarine design now uses larger supporting text and controls. The walkthrough signals interactivity through a restrained blue frame, selected number tabs, outlined rows/actions and pointer/focus feedback. There is no new instruction copy or automatic progression. See the [design system](DESIGN_SYSTEM.md) and [verification](verification/PREMIUM_THEME.md).
