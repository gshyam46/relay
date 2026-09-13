import { BUSINESS_FIT_VERSION } from "./businessFit.js";

// Preserve neutral prepared context; active criteria also bind evaluator semantics.
export function reviewContextRevisions(context) {
  return { ...context.revisions, ...(context.profile?.fit_criteria ? { business_fit_version: BUSINESS_FIT_VERSION } : {}) };
}
