# L3-02 reply policy and persistence verification

Date: 2026-09-12. Local implementation evidence under [the recorded contract](../L3-02_INTELLIGENCE_QUALITY.md). Product: AI Lead Intelligence & Outbound Automation. No customer or external model was contacted.

## Implemented behavior

The reply-specific contract preserves the original source and supplies exact JavaScript UTF-16 start/end/quote evidence, a reply policy version, interpretation mode, static reason, review requirement and optional semantic candidate. Existing event types, restrictions, tasks and persistence tables remain authoritative. Canonical classification JSON stores the additions without a schema migration.

A direct authored contact-stop request precedes sentiment, instruction-shaped text and semantic/model size limits. Negated stop requests, informational unsubscribe questions, stop-by usage, quoted/history/signature/boilerplate attribution, uncertainty and independently conflicting sentiment abstain. Ordinary CR/LF/TAB formatting is accepted. A negated interest phrase cannot gain positive meaning from the contained word interested.

Finite evaluated policy forms include English stop/unsubscribe/opt-out, remove/take-off requests, do-not/don't contact/call/email/message/text/send forms and explicit no-more-contact forms. The declared Hindi-script vocabulary covers contact/call/phone/message/sandesh/email with mat/nahi/na plus send/contact verbs or band-karo forms. Transliterated contact/message/msg/email/mail/call/phone/sampark/sandesh with mat/nahi/nahin and bhej/kar, or band-kar/kij forms is supported. Examples include Mujhe message mat bhejo and Mujhe contact mat karo. This is a finite policy lexicon, not general translation or certified multilingual comprehension.

The configured interpreter performs one fixed structured call. It validates enum/confidence, exact original authored quote and local conflict/ambiguity vetoes. Correct HIGH suggestions for otherwise unknown wording remain authoritative UNKNOWN/LOW with a separately attributed candidate, preserving a due human-review task. A possible model OPT_OUT is accepted conservatively only for locally unrecognized, unambiguous text; it remains visibly uncertain and restricted. Known positive/question/negative text or a local ambiguity veto cannot be overridden into a contradictory model opt-out. Provider failure or malformed output uses bounded static fallback text.

Canonical pending replay invokes neither a new local policy nor a new model. It reuses saved source, classification and effect identity. Conflicting new payload policy handling remains separate. New empty or transcript-only input can become a reviewable UNKNOWN or classified reply; trusted typed events retain separate attribution. Classification cannot clear an existing restriction.

## Bounds and provenance

- Full policy scan: at most 5,242,880 UTF-16 characters, matching the maximum ASCII character count of the already byte-bounded 5MiB ingress. No silent truncation is used as semantic authority. The existing SendGrid full-body opt-out path beyond its retained 32,768-character preview remains intact.
- Semantic/model input: at most 32,768 UTF-16 characters and 65,536 UTF-8 bytes; at most 1,000 retained authored spans. Exceeding semantic/span bounds abstains without a model call, while the full bounded policy scan can still recognize a later direct stop.
- Evidence: nonempty exact original span, at most 300 UTF-16 characters, wholly inside an accepted authored span. Normal formatting is preserved in raw storage.
- Versions: l3.02-reply-policy-v1 and l3.02-reply-prompt-v1. Non-model paths carry null prompt version. Optional provider/model identifiers are bounded 100/200-character configured identifiers or null; unsafe identifiers, endpoints, key-shaped values and exceptions are not copied into explanations.

The quote establishes attribution, not semantic truth. Source markers and finite language rules remain heuristic; unrecognized forms require human reading. Native-language/customer review and broader held-out testing remain open.

## Tests and results

Owned suites:

~~~text
node scripts/run-tests.js test/l302-reply-policy.test.js test/l302-reply-runtime.test.js
16 tests: 16 passed, 0 failed, 0 skipped
~~~

Final scoped compatibility run after the final source refinement:

~~~text
node scripts/run-tests.js test/l302-reply-policy.test.js test/l302-reply-runtime.test.js test/reply-classifier.test.js test/l1-ai-grounding.test.js test/inbound-replay.test.js test/inbound-contact-policy.test.js
91 tests: 91 passed, 0 failed, 0 skipped
~~~

Coverage includes direct and negated contact requests, quoted footers/history, finite Hindi/transliterated forms, ordinary multiline and UTF-16 offsets, contradictory/uncertain intent, model candidates and possible opt-out, malformed/failure/metadata bounds, full-scan versus semantic caps, durable duplicate-contact restriction before message failure, exact persisted metadata, human-review obligations, canonical pending replay under a changed interpreter, typed-provider attribution and retained restrictions after later replies.

The safe test wrapper removes inherited database/provider configuration and uses disposable local SQLite. Provider scenarios inject fixtures, not live adapters. Existing replay/contact/grounding assertions were retained.

## Independent evaluation chronology

The evaluator froze corpus SHA-256 fb947b5bae9e05a71b8655aec2d5a6d92420c9b2f01f254c819101bf03ddfc85 before runtime edits. Its first observations found three substantive misses: not-sure uncertainty, independent mixed positive/negative wording and the transliterated contact verb. Runtime fixes added regression cases without relabeling the corpus. The evaluator owns final metric/source hashes and synthetic gate outcomes in its separate artifacts. These engineering scenarios, including development reproductions, are not customer or real-model held-out quality evidence.

## Files and remaining acceptance

Owned source: channels/replyInterpretationContract.js, replyClassifier.js, inboundMessageService.js and ai/llmReplyClassifier.js. Owned tests: l302-reply-policy.test.js and l302-reply-runtime.test.js. Root owns provider transport, read projections, SendGrid integration, synthesis and shared documentation; independent evaluation and UI browser checks are separate.

Required human/native-language work: review false and missed restrictions on representative messages, evaluate quoted/bottom-posted/signature formats, measure abstention/operator burden and candidate usefulness, and review uncertainty display without clearing restrictions. Actual hosted-model, provider and PostgreSQL acceptance remain open. There was no deployment, live send, credential use or production-data operation.
