import { CHANNEL_CONFIGURATION, reviewError } from "../outbound-automation/preparedActionContract.js";
import { assessEmailConfiguration } from "./emailConnectionContract.js";
import { fingerprint } from "../outbound-automation/preparedActionContract.js";
import { verificationRuntime, probeCopy, verificationError } from "./emailVerificationContract.js";

const runtimes = new WeakMap();
const STRICT_RUNTIME = Object.freeze({ legacy_adapter_tests: false, emailVerification: verificationRuntime() });
const HOLD_MESSAGES = Object.freeze({
  CHANNEL_LIVE_UNSUPPORTED: "This live channel or provider is not enabled for the supported product workflow. Use Sandbox.",
  CHANNEL_SETUP_REQUIRED: "Complete the supported SendGrid sender, return address, credential and signing-key setup before review.",
  CHANNEL_VERIFICATION_REQUIRED: "Live email dispatch requires current provider checks and recorded controlled delivery, failure, reply and stop evidence."
});

export function configureChannelRuntime(db, config) {
  const runtime = Object.freeze({ legacy_adapter_tests: config?.env === "test" && config?.security?.testControlsEnabled === true && config?.security?.isolatedE2eHarness !== true, emailVerification: verificationRuntime({ publicOrigin: config?.security?.publicAppOrigin, controlledRecipients: config?.emailVerification?.controlledRecipients }) });
  const root = db.rootDatabase || db;
  const previous = runtimes.get(root);
  if (previous && fingerprint(previous) !== fingerprint(runtime)) throw new TypeError("The channel runtime profile is immutable for a database instance.");
  if (previous) return previous;
  runtimes.set(root, runtime);
  return runtime;
}
export function channelRuntimeFor(db) { return runtimes.get(db.rootDatabase || db) || STRICT_RUNTIME; }
export function assessChannelCapability({ action_type, configuration = {}, runtime = STRICT_RUNTIME }) {
  if (action_type === "CREATE_HUMAN_TASK") return { channel: "HUMAN_TASK", provider: "human-task", implementation_supported: true, configuration_complete: true, can_review: true, can_dispatch: true, verification: "NOT_APPLICABLE", review_hold_code: null, dispatch_hold_code: null };
  const info = CHANNEL_CONFIGURATION[action_type], provider = configuration?.provider || "sandbox";
  const supported = Boolean(info && info.providers.includes(provider));
  const base = { channel: info?.channel || null, provider: typeof provider === "string" && provider.length <= 100 ? provider : null, implementation_supported: supported, configuration_complete: false, can_review: false, can_dispatch: false, verification: "NOT_VERIFIED", review_hold_code: "CHANNEL_LIVE_UNSUPPORTED", dispatch_hold_code: "CHANNEL_LIVE_UNSUPPORTED" };
  if (!supported) return base;
  if (provider === "sandbox") return { ...base, configuration_complete: true, can_review: true, can_dispatch: true, verification: "NOT_APPLICABLE", review_hold_code: null, dispatch_hold_code: null };
  // Preserve explicit adapter/transport tests only. Never derive compatibility
  // from process.env, persisted client settings or development controls.
  if (runtime.legacy_adapter_tests === true) return { ...base, configuration_complete: true, can_review: true, can_dispatch: true, verification: "TEST_ONLY", review_hold_code: null, dispatch_hold_code: null };
  if (action_type !== "SEND_EMAIL" || provider !== "sendgrid") return { ...base, implementation_supported: false };
  const setup = assessEmailConfiguration(configuration);
  return { ...base, configuration_complete: setup.complete, can_review: setup.complete, review_hold_code: setup.complete ? null : "CHANNEL_SETUP_REQUIRED", dispatch_hold_code: setup.complete ? "CHANNEL_VERIFICATION_REQUIRED" : "CHANNEL_SETUP_REQUIRED" };
}
export function requireChannelCapability(db, { action_type, configuration, phase = "REVIEW" }) {
  if (!["REVIEW", "DISPATCH"].includes(phase)) throw new TypeError("A supported channel capability phase is required.");
  const assessment = assessChannelCapability({ action_type, configuration, runtime: channelRuntimeFor(db) });
  const code = phase === "DISPATCH" ? assessment.dispatch_hold_code : assessment.review_hold_code;
  if (code) throw reviewError(code, HOLD_MESSAGES[code]);
  return assessment;
}
export function isChannelCapabilityError(error) { return Boolean(error && Object.hasOwn(HOLD_MESSAGES, error.code)); }

// Database evidence is consulted only for dispatch. No network calls occur here.
export async function requireDispatchChannelCapability(db, { action, configuration, envelope, now = Date.now }) {
  const runtime = channelRuntimeFor(db), assessment = assessChannelCapability({ action_type: action.type, configuration, runtime });
  if (!assessment.dispatch_hold_code) return assessment;
  if (assessment.dispatch_hold_code !== "CHANNEL_VERIFICATION_REQUIRED") throw reviewError(assessment.dispatch_hold_code, HOLD_MESSAGES[assessment.dispatch_hold_code]);
  const { currentEmailVerificationInTransaction, assertNoUnresolvedProbe } = await import("./emailVerificationService.js");
  const state = await currentEmailVerificationInTransaction(db, { organization_id: action.organization_id, configuration, runtime: runtime.emailVerification, now });
  const probe = await db.get("SELECT * FROM email_verification_probes WHERE organization_id=? AND action_id=?", [action.organization_id, action.id]);
  // A probe never becomes ordinary reusable outreach after global verification.
  if (probe) {
    await assertFixedVerificationProbe(db, action, envelope);
    if (!state.current || state.run?.id !== probe.verification_id || state.verification.check?.state !== "PASSED") throw reviewError("CHANNEL_VERIFICATION_REQUIRED", HOLD_MESSAGES.CHANNEL_VERIFICATION_REQUIRED);
    try { await assertNoUnresolvedProbe(db, action.organization_id, envelope.recipient, action.id); }
    catch { throw reviewError("CHANNEL_VERIFICATION_REQUIRED", "A prior controlled send is unresolved. Reconcile its actual outcome first."); }
    return { ...assessment, can_dispatch: true, dispatch_hold_code: null, verification: "CONTROLLED_PROBE" };
  }
  if (state.available) return { ...assessment, can_dispatch: true, dispatch_hold_code: null, verification: "VERIFIED" };
  throw reviewError("CHANNEL_VERIFICATION_REQUIRED", HOLD_MESSAGES.CHANNEL_VERIFICATION_REQUIRED);
}
export async function assertFixedVerificationProbe(db, action, envelope) {
  const row = await db.get("SELECT p.*,r.nonce,r.delivery_recipient,r.failure_recipient,r.reply_to FROM email_verification_probes p JOIN email_verification_runs r ON r.organization_id=p.organization_id AND r.id=p.verification_id WHERE p.organization_id=? AND p.action_id=?", [action.organization_id, action.id]);
  if (!row) return;
  const copy = probeCopy(row, row.purpose);
  if (row.lead_id !== action.lead_id || fingerprint(envelope) !== row.content_hash || envelope.subject !== copy.subject || envelope.body !== copy.body || envelope.sender?.reply_to !== row.reply_to || envelope.recipient !== (row.purpose === "DELIVERY" ? row.delivery_recipient : row.failure_recipient) || envelope.scheduled_at !== null) throw verificationError("EMAIL_VERIFICATION_PROBE_IMMUTABLE", "Controlled verification content, sender, recipient and schedule cannot be edited or copied.");
}

// Read projection only; dispatch still evaluates its own exact action under the gate.
export async function assessCurrentChannelCapability(db, { organization_id, action_type, strict = false, now = Date.now }) {
  const { ContactPolicyService } = await import("../contact-policy/contactPolicyService.js");
  const read = async tx => {
    const registered = channelRuntimeFor(tx), runtime = strict ? { ...registered, legacy_adapter_tests: false } : registered;
    const category = CHANNEL_CONFIGURATION[action_type]?.category;
    let configuration = {};
    if (category === "channel_email") {
      const { EmailConnectionRepository } = await import("./emailConnectionRepository.js"); configuration = await new EmailConnectionRepository(tx).settings(organization_id);
    } else if (category) {
      const { SettingsRepository } = await import("../settings/settingsRepository.js"); configuration = await new SettingsRepository(tx).getCategory(organization_id, category);
    }
    const assessment = assessChannelCapability({ action_type, configuration, runtime });
    if (assessment.dispatch_hold_code !== "CHANNEL_VERIFICATION_REQUIRED") return assessment;
    const { currentEmailVerificationInTransaction } = await import("./emailVerificationService.js");
    const state = await currentEmailVerificationInTransaction(tx, { organization_id, configuration, runtime: runtime.emailVerification, now });
    return state.available ? { ...assessment, can_dispatch: true, dispatch_hold_code: null, verification: "VERIFIED" } : assessment;
  };
  return db.transactionBound ? read(db) : new ContactPolicyService(db).withWorkspacePolicyTransaction(organization_id, read);
}
