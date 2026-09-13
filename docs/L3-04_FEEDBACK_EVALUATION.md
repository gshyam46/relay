# L3-04 Audited feedback and protected evaluation

Status: implemented and verified locally on2026-09-12 under the contract recorded before runtime edits and continued authorization; [integrated evidence](verification/L3-04.md) separates local completion from external/human acceptance. Dependencies: locally implemented L3-02 interpretation/quality and L3-03 durable work/usage; their external and human gates remain open.

## Scope and decisions

Give owners a way to review an exact saved assessment, retain corrections to that review and use explicitly nominated examples in reproducible evaluation. Keep the modular monolith, existing workspace transaction, bounded AI and immutable operational history. There is no automatic training, provider call, prediction override, source correction, task resolution or contact-policy change in feedback.

Targets are SNAPSHOT (including its fit assessment as a whole), SYNTHESIS, RECOMMENDATION, PLAN and REPLY (the exact inbound channel_message). Criterion-level reviews are not separate targets in this slice. Historical/superseded/archived results remain reviewable; current source/profile changes do not silently move a review to another result. An owner who needs to fix facts uses the existing source-correction flow separately.

The first replayable customer-workspace evaluation contract is reply classification. Other assessment reviews are captured as operational quality labels for later engineering curation. Actual business outcomes and revenue/progression records remain L4-05. No owner judgment is represented as verified truth, independent adjudication or untouched customer-held-out evidence.

## Feedback authority and persistence

Add immutable intelligence_feedback_targets and append-only intelligence_feedback_revisions through migration0016. Targets bind workspace, lead, exact typed artifact foreign key, bounded immutable source snapshot/digest, capture actor and time. Exclude mutable artifact status/update timestamps from content identity. Reply input comes only from actual original text/transcript and canonical scoped classification; summary text cannot replace missing original input.

GET review derives a bounded presentation, source digest and review token without persisting a target. The first successful POST commits target, revision and audit together. Every later RECORD or WITHDRAW appends a revision with expected_feedback_revision, request_key/hash, authenticated owner, required reason and server time. Same key/intent replays the original accepted revision; changed intent conflicts. Review token and expected revision protect an open draft. Existing history is never overwritten; withdrawal and later restoration retain the full chain.

RECORD labels are exactly {correctness:CORRECT|INCORRECT|UNCLEAR,usefulness:USEFUL|NOT_USEFUL|NOT_ASSESSED,expected_category:null|POSITIVE_REPLY|NEGATIVE_REPLY|QUESTION|OPT_OUT|UNKNOWN,eval_use:OPERATIONAL_ONLY|SYNTHETIC|PERMISSION_REVIEWED}. Nonreply labels have expected_category=null and eval_use=OPERATIONAL_ONLY. Replay eligibility requires an active CORRECT/INCORRECT reply review, an explicit expected category, usable original input and explicit nomination. Nomination is an owner attestation; it does not itself establish independent labels, permission, dataset inclusion or approval to send data to a provider. WITHDRAW has null labels.

Target snapshots are bounded to1MiB; labels4KiB; reason1..2000 characters; request key1..200; each stream at most100 revisions. History defaults20/max50 and returns summaries, not private replay input or repeated full snapshots. Reads and writes recheck current workspace OWNER authority. Target FKs enforce workspace and lead where applicable.

## Frozen datasets and local replay

Add immutable intelligence_evaluation_datasets, intelligence_evaluation_members and intelligence_evaluations, plus intelligence_evaluation_groups for permanent split/consumption authority. Dataset creation explicitly selects1..100 exact feedback ID/revision pairs, name, DEV|HOLDOUT, expected_version and request_key. Admission validates the entire selection, current nomination/revision and byte bounds before one atomic commit. No automatic selection of all feedback. Same request key/intent replays the original version; changed intent or stale name/version conflicts.

Each name has incrementing immutable versions. Members retain exact feedback revision, lead, reply-text digest and case digest; manifests are bounded and hashed. A workspace lead and an exact reply-text digest are permanently assigned to one split across all datasets/versions. Duplicate text and duplicate feedback in one version are rejected. This prevents obvious reuse across splits; it does not prove independence of different contacts/enquiries or stop an administrator with database access from inspecting original customer records.

HOLDOUT is a protected replay reservation. It is aggregate-only and permits one evaluation per underlying group across all dataset versions. A repeated request for the same dataset and captured candidate returns its original result; changing the candidate or wrapping consumed cases in another version cannot gain another held-out evaluation. DEV may evaluate a new candidate identity. Withdrawal or relabeling does not release split assignments/consumption.

A new evaluation rechecks unchanged active label revisions and nomination. Older stored metrics remain historical and expose labels_current=false after a correction/withdrawal; they do not become current evidence. No source text, individual label, per-case prediction, membership identity or private original input is returned from dataset/evaluation APIs. No dataset export or training endpoint is introduced.

Evaluate at most100 cases and4MiB private snapshots using CURRENT_LOCAL_RULES only, inside the existing bounded workspace unit of work with no network/model I/O. Candidate source and version identity are server-owned and frozen from the loaded implementation; client-supplied predictions, metrics, source hashes or model overrides are rejected. Failure rolls back result/audit/holdout consumption together. This is local synchronous computation, not a second analysis queue.

Compare recorded operational categories to owner labels as the historical baseline, and current local reply rules to those same labels as candidate. Report exact counts/denominators, correct/incorrect/abstention and expected/missed/false opt-outs against reviewed labels. The stored operational baseline may have used a different model/method; this is not a controlled hosted-model comparison. UNKNOWN remains a valid expected judgment and abstention stays visible. Runtime feedback evaluation never claims deployment or model-quality PASS.

## Engineering regression gate

Preserve the frozen L3-02 synthetic corpus and independently recorded baseline counters. Add a reproducible, network-disabled engineering gate that recomputes the current implementation and verifies manifest, source/version identity, exact denominators, zero safety regressions and per-class/coverage floors against the pinned baseline. Candidate report authenticity is derived from the local run; an arbitrary uploaded report cannot satisfy the gate.

The baseline is46 replies,35 labeled messages, at least26 correct and no more20 abstentions; positive/negative/question/opt-out true-positive floors are3/2/4/17 with original class denominators6/5/7/17. Preserve all grounding/provider/composer safety obligations and zero explicit-stop misses/false stops. Baseline/corpus/grader changes need separately reviewed versioned artifacts; never overwrite labels to make a code change pass. CI and the local CI command run this engineering gate.

This gates the exercised code/rules and injected model boundaries. Actual configured-model selection, hosted quality/cost, independent customer usefulness and release authorization remain unmeasured external gates. Existing production/provider configuration is not automatically promoted by a synthetic pass.

## API and operator flow

Owner-only feedback routes: GET /api/intelligence-feedback/target and /history with lead_id,target_kind,target_id; POST /api/intelligence-feedback with those fields, review_token,expected_feedback_revision,request_key,operation,labels,reason. Authenticated workspace and actor override client identity. A GET request-key lookup supports lost-response recovery. The response exposes exact bounded target presentation, revisioned review/history and capabilities; private input remains server-only.

Owner-only evaluation routes: POST/GET /api/intelligence-evaluation/datasets, GET /:id, POST /:id/evaluate and GET /:id/evaluations. Creation returns immutable dataset metadata with labels_current/can_evaluate/hold_reason. Lists use bounded cursor pagination. Evaluation returns server-computed aggregate history and candidate identity, never individual holdout outputs.

Lead assessment and reply screens open a lazy review panel. Drafts keep their original target, reason and request identity across conflicts/failures. Viewing/refetching creates no feedback, dataset, analysis or contact action. A separate owner evaluation workspace allows explicit nominated-reply selection, frozen dataset versions and aggregate comparisons, with clear protected replay and label-currentness limits. No developer-only route belongs in this normal workflow.

## Ownership and verification

Root owns shared API/factory/logger, migration0016/registry, package/CI wiring and shared Markdown. Backend owns src/modules/intelligence-feedback/* and focused feedback/source tests. Evaluation owner owns src/modules/intelligence-evaluation/*, pinned synthetic baseline/gate helpers and focused dataset/metric tests. UI owns new feedback/evaluation types/hooks/components, narrow lead/reply/Intelligence integration and isolated actual-browser verification. Resolve response shapes before dependent editing.

Behavioral checks: atomic target/revision/audit commits, actor/tenant/artifact boundaries, no GET writes, missing/oversized/corrupt inputs, stale target/review/request-key races, history and withdrawal/restoration, unchanged source/stop/approval/task state, immutable dataset versions, explicit membership, changed labels, cross-split duplicate/group protection, consumed holdout refusal, forged candidate/metrics rejection, aggregate-only/private-data projection, bounded local replay, exact count metrics and pinned baseline/source validation. Test additive migration preservation/rollback with explicit PostgreSQL cases. Use sanitized disposable targets only.

Actual React checks must cover assessment/reply review, original-target preservation, stale and lost-response recovery, nominal exclusion versus dataset inclusion, withdrawal/history, explicit frozen selection, aggregate local comparison and consumed/changed-label holds. Human/customer/native-language QA must separately validate usefulness, labels, independent cohort selection, accessible operator flows and processing permission. Local implementation cannot close those gates.

## Integration clarifications

GET /api/intelligence-feedback/candidates lists latest RECORDED nominated REPLY reviews with stable after_feedback_id pagination (default20/max50), feedback summaries and lead names bounded to200 characters. It exposes no original text or dataset membership. GET /api/intelligence-evaluation/requests/:request_key returns {dataset:null|metadata} for read-only creation recovery. Overall correctness is independent of expected_category; classification metrics use only the explicitly reviewed category.
