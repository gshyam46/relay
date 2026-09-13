# L3-02 Factuality, reply safety and evaluation

Status: contract recorded 2026-09-12 before implementation, under the user's continued authorization. Dependencies: implemented L1-09 grounding and L3-01 configured fit; their customer and external acceptance remains open. This slice remains [~] until representative customer/native-language and hosted-model evidence is available.

## Intended outcome

An operator can distinguish exact source extraction, a model suggestion, a fallback and an unrecorded historical method. Reply interpretation preserves its supporting original text. Explicit current stop requests establish durable restrictions; ambiguous wording and model output require review. Synthetic evaluation exposes errors, abstention and coverage without claiming measured customer or real-model quality.

Read-only probes reproduced false opt-outs for negation, stop-by language and quoted footers; missed direct English/Hindi/transliterated stop requests; false positive interest from negation; and unnecessary rejection of ordinary multiline replies. Accepted model quotes were discarded. The UI hid low-confidence opt-out behind a generic review badge and called every latest inbound a reply obligation.

## Reply contract and policy

Keep existing event types, database tables and app-owned suggested next steps. Add a versioned reply-specific interpretation contract; do not reuse the 500-character single-fact grounding guard as a whole-message parser.

Preserve the original body. Derive authored-source spans and quoted/history/signature markers without rewriting the persisted message. Evidence is an exact original {start,end,quote}, using JavaScript UTF-16 offsets; it must lie wholly within an accepted authored span. Uncertain attribution cannot become positive intent or an opt-out from quoted history.

Scan the full already-bounded ingress for explicit authored stop requests before semantic/model limits. Preserve SendGrid's detection beyond its retained 32768-character text. Direct current stop requests override sentiment and instruction-like text. Negated stop requests, unsubscribe questions, stop-by usage, quoted boilerplate and other ambiguous intent abstain without creating consent or clearing any restriction. The finite evaluated policy scope is English plus explicitly listed Hindi-script and Hindi/transliterated stop forms; broader multilingual understanding is not certified.

Normal CR/LF/TAB formatting is allowed. Input type/size/control/instruction checks are bounded and fail to UNKNOWN plus review. Explicit policy detection precedes model invocation and semantic length limits. All ambiguity vetoes remain effective even if an injected model insists on a positive or opt-out label.

The configured model keeps a fixed JSON enum/confidence/exact-evidence-quote contract and one bounded call. Exact quote support proves attribution, not semantic truth. Known local/model disagreement and malformed/low-confidence operational classifications abstain. A HIGH model suggestion for otherwise unrecognized wording may be retained as a reviewed candidate while the authoritative event remains UNKNOWN; this makes semantic interpretation available without silently allowing it to remove the human-review obligation. Candidate event types and evidence are typed data, not instructions.

An otherwise valid model OPT_OUT for locally unrecognized, unambiguous authored text retains the existing conservative stop behavior and is explicitly labeled possible model interpretation requiring review. It does not prove a customer-confirmed restriction; false restriction rates are measured separately. A model cannot turn known positive/question/negative wording or a local ambiguity veto into a contradictory automatic opt-out. Existing restrictions cannot be lifted by classification; resubscription remains separate work.

Every new classifier result carries existing event_type/confidence/reason/suggested_next_step plus:
- generation: mode (LOCAL_POLICY, DETERMINISTIC_CLASSIFICATION, LLM_CLASSIFICATION or DETERMINISTIC_FALLBACK), reason (fixed code or null), reply_policy_version, prompt_version (null for non-model paths);
- evidence: exact original span or null;
- review_required: boolean;
- candidate: null or {event_type,confidence,evidence} for a retained model suggestion.

Use only bounded static reason/next-step text. Never persist provider exceptions, endpoints, keys or prompt instructions as explanations. Provider/model attribution belongs to bounded configured identifiers when supplied; missing metadata remains unknown. Existing canonical classification payload JSON persists these additions without a migration. Canonical replay retains the original interpretation and effects; changing the classifier cannot silently reclassify old events or release a restriction. Trusted typed provider events remain a separate attribution path, not falsely labeled as classified text.

## Grounding and provider boundaries

Keep exact supported field/value/reference selection and application-owned quotation. Empty model selection is an explicit review/abstention result, not an unexplained successful summary. Advance the synthesis version for changed semantics, retaining old historical artifacts and existing current-input finalization guards. Derived version changes do not themselves rewrite already-reviewed historical outbound copy.

The inspected OpenAI-compatible adapter used an unbounded fetch/JSON read. The implementation now routes it through the existing bounded provider transport inside the replaceable adapter: fixed deadline no greater than 15 seconds, bounded JSON response 64KiB, bounded request 256KiB, no redirects, fixed safe failures and no automatic retries. Reject malformed/tool-call/non-text completion envelopes instead of treating them as successful source output. No external model is called during these implementation tests. This does not implement L3-03 job/cost accounting.

## Read projection and UI

Root exposes the same bounded persisted interpretation projection for channel messages and lead timeline: {event_type,confidence,reason,suggested_next_step,generation,evidence,review_required,candidate}, with historical absent metadata represented as null. Do not infer history from today's configured model. Invalid/unrecognized metadata becomes unavailable/review copy; raw original reply remains separately available.

UI shows category and contact-stop state independently of uncertainty. An OPT_OUT remains visibly stop-contact even at LOW confidence. The latest-message banner does not fabricate a reply obligation for opt-outs. Retained candidates are suggestions requiring human reading, not confirmed intent. Synthesis shows method/fallback, exact supported claims and source-confidence limitations. Use existing lead/source review links; no new retry job, composer, inbox state machine or review-completion command.

## Evaluation evidence

An independent owner freezes the synthetic corpus before runtime fixes: manifest/hash, case IDs, origin, language/script, gold semantic class (nullable for ambiguity), separately allowed safe outcomes, explicit opt-out expectation, risk tags, rationale and exact evidence spans/material fact tuples.

Keep reply-message cases separate from injected-adapter challenge scenarios. Report full per-class/per-language confusion matrices, precision/recall with null zero-denominator values, abstention/coverage, explicit opt-out misses and false opt-outs. UNKNOWN does not count as a successful explicit opt-out. Grade summary assertions against independent expected fact tuples; report unsupported claims, mismatched support, contradiction/staleness/inference, malicious output and unsafe promises separately.

The reproducible runner uses bundled synthetic inputs, injected adapters, sanitized environment and no customer/provider target. Record corpus and source/prompt/version hashes, observations and gate failures, with measured local harness time clearly separate from provider cost/latency. Synthetic safety PASS/FAIL and customer/hosted-model quality NOT_MEASURED are separate fields; there is no production-ready aggregate PASS. Findings discovered while editing are regression challenges, not genuinely held-out customer evaluation.

## Acceptance and ownership

Root owns shared docs/API/read projection/provider transport and synthesis refinement; backend owns reply interpretation/policy/classifiers and narrowly necessary canonical persistence; independent evaluation owns frozen corpus/runner/metric tests; UI owns method/interpretation components, narrow pages/types and browser verification. No shared file edits without agreed ownership. Root retains package scripts/config/migration registry.

Automated checks: reproduced policy errors, quoted/negated/multiline input, exact source spans, model disagreement/unknown/failure, provider bytes/deadline/redirect/malformed envelopes, durable restriction and canonical replay, source/tenant/currentness guards, independent evaluation metrics and shipped browser states. Existing relevant regressions and the full safe suite must pass without weakening assertions. Human/native-language labeling, representative held-out corpus, live model evaluation, hosted PostgreSQL/provider recovery and mobile/accessibility acceptance remain explicit open gates.

Reply bounds fixed before implementation: preserve the existing full ingress policy scan up to its 5 MiB ceiling; semantic/model input is at most 32768 UTF-16 characters and 64 KiB UTF-8, with at most 1000 retained authored spans and evidence quotes at most 300 characters. Excess semantic/attribution complexity abstains while a full bounded policy scan still detects explicit authored stop requests. Optional generation provider/model fields are nullable bounded configured identifiers (100/200 characters), never endpoints, keys or current-setting guesses.

Public timeline original_text is nullable and independent from application summary; it never reconstructs missing customer text. Provider requests also cap 32 text messages and 4096 requested output tokens, and require a single assistant completion with finish_reason=stop and no tool/refusal payload. The synthesis pipeline version is l3.02-extractive-synthesis-v3.
