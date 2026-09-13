// Presentation fixtures only. Expected examples follow L2/L3 evidence and L1 review/stop contracts.
// This is not the application's qualification, permission or sending implementation.
export const DEMO_VERSION = "landing-example-v1";
export type DemoFact = { label: string; value: string; excerpt: string | null; outcome: "MATCH" | "UNKNOWN"; explanation: string };
export type DemoRecord = { id: string; name: string; company: string; initials: string; email: string; source: string; date: string; title: string; quote: string; fit: string; contact: string; restricted: boolean; note: string; facts: DemoFact[]; action: "ASK" | "FOLLOW_UP" | "STOP"; subject: string; draft: string };
export const DEMO_RECORDS: DemoRecord[] = [
  {
    id: "mira", name: "Mira Shah", company: "Form Studio", initials: "MS", email: "mira@example.com", source: "Sample enquiry form", date: "12 Sep 2026", title: "A good fit. One important unknown.",
    quote: "We need 12 workstations for our Bengaluru studio. We are aiming for installation in October. Could you share some options?",
    fit: "Needs review", contact: "Review required", restricted: false, note: "Interest and location match the sample business. Budget is not recorded; missing information is not a failed criterion.",
    facts: [
      { label: "Interest", value: "12 workstations", excerpt: "We need 12 workstations", outcome: "MATCH", explanation: "The sample business offers workstations. The enquiry uses an explicitly accepted term." },
      { label: "Location", value: "Bengaluru, India", excerpt: "our Bengaluru studio", outcome: "MATCH", explanation: "Bengaluru is a configured service area. India is supplied by this sample form's country field." },
      { label: "Budget", value: "Not recorded", excerpt: null, outcome: "UNKNOWN", explanation: "The sample business requires a budget of at least INR 200,000. No budget appears in this source, so fit remains unresolved." },
    ],
    action: "ASK", subject: "A budget question for your studio workstations", draft: "Hi Mira,\n\nYou mentioned 12 workstations for your Bengaluru studio. What budget range are you considering? That will help us choose which options to discuss.\n\nThank you",
  },
  {
    id: "arjun", name: "Arjun Rao", company: "Northline Office", initials: "AR", email: "arjun@example.com", source: "Sample recorded enquiry", date: "12 Sep 2026", title: "A clear request for the next conversation.",
    quote: "We are looking for 16 workstations in Bengaluru. Our budget is INR 280,000. Please follow up by email on 16 September 2026 with the options.",
    fit: "Matches sample criteria", contact: "Review required", restricted: false, note: "The source records a matching interest, service area, budget and an explicit follow-up request. Actual sending still needs independent policy checks and review.",
    facts: [
      { label: "Interest", value: "16 workstations", excerpt: "looking for 16 workstations", outcome: "MATCH", explanation: "The requested offering matches the sample business's accepted interest term." },
      { label: "Budget", value: "INR 280,000", excerpt: "Our budget is INR 280,000", outcome: "MATCH", explanation: "This stated budget meets the sample INR 200,000 minimum in the same currency. No currency conversion is assumed." },
      { label: "Follow-up", value: "16 Sep 2026", excerpt: "Please follow up by email on 16 September 2026", outcome: "MATCH", explanation: "The requested date is recorded in the source. The example uses fixed September 2026 dates, not today's date." },
    ],
    action: "FOLLOW_UP", subject: "Your Bengaluru workstation enquiry", draft: "Hi Arjun,\n\nYou asked us to follow up about 16 workstations in Bengaluru with a budget of INR 280,000. Is there a preferred layout or finish you would like us to consider?\n\nThank you",
  },
    {
    id: "dev", name: "Dev Mehta", company: "Common Ground", initials: "DM", email: "dev@example.com", source: "Sample enquiry + stop reply", date: "12 Sep 2026", title: "A matching enquiry can still mean stop.",
    quote: "Earlier enquiry: 10 workstations in Bengaluru, budget INR 250,000. Latest reply: Please stop emailing me. I do not want further contact.",
    fit: "Matches sample criteria", contact: "Contact restricted", restricted: true, note: "The earlier enquiry matches the sample criteria. The later explicit stop request blocks further outreach; fit never grants contact permission.",
    facts: [
      { label: "Interest", value: "10 workstations", excerpt: "10 workstations in Bengaluru", outcome: "MATCH", explanation: "A historical offering match remains visible. It does not override the later stop request." },
      { label: "Budget", value: "INR 250,000", excerpt: "budget INR 250,000", outcome: "MATCH", explanation: "The recorded budget meets the sample minimum. This is separate from permission to contact." },
      { label: "Contact", value: "Explicit opt-out", excerpt: "Please stop emailing me. I do not want further contact.", outcome: "MATCH", explanation: "The explicit stop request is the reason for the contact restriction. No new message is available in this example." },
    ],
    action: "STOP", subject: "", draft: "",
  },
];
export const DEMO_STEPS = ["Source", "Intelligence", "Decision", "Review", "Response", "Outcome"] as const;
export type DemoReply = "QUESTION" | "NO_RESPONSE" | "OPT_OUT" | null;
export type DemoState = { recordId: string; step: number; fact: number; action: "ASK" | "FOLLOW_UP" | "STOP"; subject: string; draft: string; revision: number; reviewedRevision: number | null; simulated: boolean; reply: DemoReply; outcome: "MEETING_REQUESTED" | "FOLLOW_UP_RECORDED" | "CLOSED" | null };
export function demoFor(recordId = DEMO_RECORDS[0].id): DemoState { const record = DEMO_RECORDS.find(item => item.id === recordId)!; return { recordId, step: 0, fact: 0, action: record.action, subject: record.subject, draft: record.draft, revision: 1, reviewedRevision: null, simulated: false, reply: record.restricted ? "OPT_OUT" : null, outcome: null }; }
