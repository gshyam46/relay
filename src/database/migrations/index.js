import * as workspaceDataErasures from "./0023_workspace_data_erasures.js";
import * as pilotInterestOperations from "./0024_pilot_interest_operations.js";
import * as emailVerification from "./0022_email_verification.js";
import * as customerWorkflow from "./0021_customer_workflow.js";
import * as accountSecurity from "./0019_account_security.js";
import * as pilotInterest from "./0020_pilot_interest.js";
import * as actionComposerCommands from "./0018_action_composer_commands.js";
import * as emailConnectionSetup from "./0017_email_connection_setup.js";
import * as intelligenceFeedbackEvaluation from "./0016_intelligence_feedback_evaluation.js";
import * as analysisJobsAiUsage from "./0015_analysis_jobs_ai_usage.js";
import * as baselineSchema from "./0001_baseline_schema.js";
import * as runtimeColumnReconciliation from "./0002_runtime_column_reconciliation.js";
import * as contactRestrictions from "./0003_contact_restrictions.js";
import * as preparedActionRevisions from "./0004_prepared_action_revisions.js";
import * as boundedDispatchRecovery from "./0005_bounded_dispatch_recovery.js";
import * as durableWebhookReceipts from "./0006_durable_webhook_receipts.js";
import * as schedulerEventRecovery from "./0007_scheduler_event_recovery.js";
import * as operationalControls from "./0008_operational_controls.js";
import * as businessContext from "./0009_business_context.js";
import * as reviewedImport from "./0010_reviewed_import.js";
import * as importIdentityResolution from "./0011_import_identity_resolution.js";
import * as leadDataManagement from "./0012_lead_data_management.js";
import * as businessFit from "./0014_business_fit.js";
import * as intelligenceFreshness from "./0013_intelligence_freshness.js";

/**
 * Ordered migration list.
 *
 * Migrations are listed explicitly rather than discovered by reading the
 * directory: the order is the contract, and an explicit list makes an
 * accidentally-misnamed file a visible omission instead of a silent reordering.
 *
 * To add one: create `NNNN_short_name.js` exporting `id` and `up(db)`, import it
 * here, and append it to the array. Never edit or reorder an already-released
 * migration — deployed databases have recorded it as applied and will not run it
 * again.
 */
export const MIGRATIONS = Object.freeze([baselineSchema, runtimeColumnReconciliation, contactRestrictions, preparedActionRevisions, boundedDispatchRecovery, durableWebhookReceipts, schedulerEventRecovery, operationalControls, businessContext, reviewedImport, importIdentityResolution, leadDataManagement, intelligenceFreshness, businessFit, analysisJobsAiUsage, intelligenceFeedbackEvaluation, emailConnectionSetup, actionComposerCommands, accountSecurity, pilotInterest, customerWorkflow, emailVerification, workspaceDataErasures, pilotInterestOperations]);
