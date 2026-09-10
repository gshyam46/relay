import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  MessageSquare,
  Building2,
  Search,
  Filter,
  Zap,
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
  User,
  Radio,
  ArrowUpRight,
  ReplyIcon,
  ThumbsUp,
  ThumbsDown,
  HelpCircle,
  ShieldAlert,
  Ban,
} from "lucide-react";
import { Header } from "@/components/layout/header";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { useWorkspaceStore } from "@/stores/workspace";
import { useChannelMessages, useSimulateInbound, type ChannelMessage } from "@/hooks/use-channels";
import { useLeads } from "@/hooks/use-leads";
import { cn } from "@/lib/utils";

const CHANNELS = ["EMAIL", "WHATSAPP", "SMS", "VOICE"] as const;

export function ConversationsPage() {
  const org = useWorkspaceStore((s) => s.currentOrg);

  return (
    <>
      <Header
        title="Conversations"
        description={org?.name}
        actions={org ? <SimulateReplyButton /> : undefined}
      />
      {org ? <ConversationsContent /> : (
        <EmptyState icon={Building2} title="No workspace selected" description="Select or create a workspace first." />
      )}
    </>
  );
}

interface Conversation {
  leadId: string;
  leadName: string | null;
  leadCompany: string | null;
  messages: ChannelMessage[];
  lastMessage: ChannelMessage;
  needsReply: boolean;
}

function ConversationsContent() {
  const [channel, setChannel] = useState<string | undefined>(undefined);
  const [direction, setDirection] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState("");
  const [openLeadId, setOpenLeadId] = useState<string | null>(null);
  const { data: messages, isLoading, isError, refetch } = useChannelMessages({ channel, direction });

  const conversations = useMemo<Conversation[]>(() => {
    if (!messages) return [];
    const byLead = new Map<string, ChannelMessage[]>();
    for (const m of messages) {
      // A conversation is what was actually said to and by the lead. Internal
      // human tasks are recorded on the same channel_messages table so they show
      // up on the lead's activity timeline, but surfacing them here is what made
      // this screen read as a log: rows saying "You: Follow up with X based on
      // the current lead intelligence" are notes to ourselves, not messages.
      // They remain visible on the lead's Outbound & Activity tab.
      if (!CHANNELS.includes(m.channel as (typeof CHANNELS)[number])) continue;
      const list = byLead.get(m.lead_id) || [];
      list.push(m);
      byLead.set(m.lead_id, list);
    }
    const result: Conversation[] = [];
    for (const [leadId, list] of byLead) {
      const sorted = [...list].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
      const last = sorted[0];
      result.push({
        leadId,
        leadName: last.lead_name,
        leadCompany: last.lead_company,
        messages: sorted,
        lastMessage: last,
        needsReply: last.direction === "INBOUND",
      });
    }
    result.sort((a, b) => b.lastMessage.occurred_at.localeCompare(a.lastMessage.occurred_at));
    return result;
  }, [messages]);

  const filtered = useMemo(() => {
    if (!search) return conversations;
    const q = search.toLowerCase();
    return conversations.filter((c) => c.leadName?.toLowerCase().includes(q) || c.leadCompany?.toLowerCase().includes(q));
  }, [conversations, search]);

  const openConversation = conversations.find((c) => c.leadId === openLeadId) || null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-6 py-3 border-b border-line bg-surface flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by lead..."
            className="w-full pl-9 pr-4 py-2 text-sm border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <Filter className="w-3.5 h-3.5 text-muted" />
          {(["ALL", "INBOUND", "OUTBOUND"] as const).map((d) => (
            <button
              key={d}
              onClick={() => setDirection(d === "ALL" ? undefined : d)}
              className={cn(
                "px-2.5 py-1 text-xs font-medium rounded-full transition-colors cursor-pointer",
                (direction ?? "ALL") === d ? "bg-brand text-white" : "bg-soft text-muted hover:text-ink",
              )}
            >
              {formatLabel(d)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          {(["ALL", ...CHANNELS] as const).map((c) => (
            <button
              key={c}
              onClick={() => setChannel(c === "ALL" ? undefined : c)}
              className={cn(
                "px-2.5 py-1 text-xs font-medium rounded-full transition-colors cursor-pointer",
                (channel ?? "ALL") === c ? "bg-brand text-white" : "bg-soft text-muted hover:text-ink",
              )}
            >
              {formatLabel(c)}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted ml-auto shrink-0">{filtered.length} conversation{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      {isError ? (
        <ErrorState title="Couldn't load conversations" onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="p-6 space-y-2 flex-1">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-16 bg-surface border border-line rounded-lg animate-pulse" />
          ))}
        </div>
      ) : filtered.length > 0 ? (
        <div className="flex-1 overflow-y-auto divide-y divide-line">
          {filtered.map((c) => (
            <ConversationRow key={c.leadId} conversation={c} onClick={() => setOpenLeadId(c.leadId)} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={MessageSquare}
          title="No conversations yet"
          description="Outbound sends and inbound replies across every channel show up here. Use “Simulate reply” above to try inbound for free."
        />
      )}

      {openConversation && <ConversationPanel conversation={openConversation} onClose={() => setOpenLeadId(null)} />}
    </div>
  );
}

function ConversationRow({ conversation, onClick }: { conversation: Conversation; onClick: () => void }) {
  const { leadName, leadCompany, lastMessage, messages, needsReply } = conversation;
  const inbound = lastMessage.direction === "INBOUND";
  return (
    <button onClick={onClick} className="flex items-start gap-3 w-full px-6 py-3 text-left hover:bg-soft transition-colors cursor-pointer">
      <div
        className={cn(
          "w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
          inbound ? "bg-ok-light text-ok" : "bg-brand-light text-brand",
        )}
      >
        {(leadName?.[0] ?? "?").toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium text-ink">{leadName || "Unnamed"}</p>
          {leadCompany && <span className="text-[11px] text-muted">{leadCompany}</span>}
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-soft text-muted">{formatLabel(lastMessage.channel)}</span>
          <span className="text-[10px] text-subtle">{messages.length} message{messages.length !== 1 ? "s" : ""}</span>
          {inbound && lastMessage.classification_event_type && (
            <ClassificationBadge
              eventType={lastMessage.classification_event_type}
              confidence={lastMessage.classification_confidence}
            />
          )}
          {needsReply && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-warn-light text-warn">
              <ReplyIcon className="w-2.5 h-2.5" />
              Needs reply
            </span>
          )}
        </div>
        <p className="text-sm text-muted mt-0.5 truncate">
          {inbound ? "" : "You: "}
          {lastMessage.body || lastMessage.summary || lastMessage.subject}
        </p>
      </div>
      <span className="text-xs text-muted shrink-0">{new Date(lastMessage.occurred_at).toLocaleString()}</span>
    </button>
  );
}

function ConversationPanel({ conversation, onClose }: { conversation: Conversation; onClose: () => void }) {
  const navigate = useNavigate();
  const sorted = [...conversation.messages].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div
        className="relative w-full max-w-md bg-surface border-l border-line shadow-2xl flex flex-col h-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-line shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-full bg-brand-light text-brand flex items-center justify-center text-xs font-bold shrink-0">
              {(conversation.leadName?.[0] ?? "?").toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink truncate">{conversation.leadName || "Unnamed"}</p>
              {conversation.leadCompany && <p className="text-[11px] text-muted truncate">{conversation.leadCompany}</p>}
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-soft cursor-pointer shrink-0">
            <X className="w-4 h-4 text-muted" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {sorted.map((m) => {
            const inbound = m.direction === "INBOUND";
            return (
              <div key={m.id} className={cn("flex gap-2.5", inbound ? "flex-row" : "flex-row-reverse")}>
                <div
                  className={cn(
                    "w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5",
                    inbound ? "bg-ok-light text-ok" : "bg-brand-light text-brand",
                  )}
                >
                  {inbound ? <User className="w-3 h-3" /> : <Radio className="w-3 h-3" />}
                </div>
                <div className={cn("max-w-[80%] rounded-xl px-3.5 py-2.5", inbound ? "bg-ok-light" : "bg-page border border-line")}>
                  <div className={cn("flex items-center gap-2 mb-1 flex-wrap", inbound ? "" : "flex-row-reverse")}>
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">{formatLabel(m.channel)}</span>
                    <span className="text-[10px] text-subtle">{new Date(m.occurred_at).toLocaleString()}</span>
                    {inbound && m.classification_event_type && (
                      <ClassificationBadge eventType={m.classification_event_type} confidence={m.classification_confidence} />
                    )}
                  </div>
                  <p className="text-sm text-ink">{m.body || m.summary || m.subject}</p>
                  {inbound && m.suggested_next_step && (
                    <p className="text-xs text-muted mt-1.5 pt-1.5 border-t border-ok/20">
                      <span className="font-semibold text-ink">Suggested: </span>
                      {m.suggested_next_step}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="px-5 py-3 border-t border-line shrink-0">
          <button
            onClick={() => navigate(`/leads/${conversation.leadId}?tab=outbound`)}
            className="flex items-center gap-1.5 text-xs font-medium text-brand hover:text-brand-strong cursor-pointer"
          >
            Open full lead record
            <ArrowUpRight className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

function SimulateReplyButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-brand text-white rounded-lg hover:bg-brand-strong transition-colors cursor-pointer"
      >
        <Zap className="w-3.5 h-3.5" />
        Simulate reply
      </button>
      {open && <SimulateReplyDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function SimulateReplyDialog({ onClose }: { onClose: () => void }) {
  const [leadSearch, setLeadSearch] = useState("");
  const [leadId, setLeadId] = useState<string | null>(null);
  const [leadLabel, setLeadLabel] = useState("");
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]>("EMAIL");
  const [eventType, setEventType] = useState<"AUTO" | "POSITIVE_REPLY" | "NEGATIVE_REPLY" | "QUESTION" | "OPT_OUT" | "UNKNOWN">("AUTO");
  const [text, setText] = useState("");
  const { data: leads } = useLeads({ search: leadSearch });
  const simulate = useSimulateInbound();
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const handleSubmit = async () => {
    if (!leadId) {
      setFeedback({ type: "error", message: "Pick a lead first." });
      return;
    }
    if (eventType === "AUTO" && !text.trim()) {
      setFeedback({ type: "error", message: "Auto-detect needs message text to classify." });
      return;
    }
    try {
      const result = await simulate.mutateAsync({
        lead_id: leadId,
        channel,
        event_type: eventType === "AUTO" ? undefined : eventType,
        text: text || undefined,
      });
      const c = result.classification;
      setFeedback({
        type: "success",
        message: c
          ? `Classified as ${formatLabel(c.event_type)} (${c.confidence.toLowerCase()} confidence).${c.suggested_next_step ? ` Suggested: ${c.suggested_next_step}` : ""}`
          : "Inbound reply simulated — check the lead's timeline.",
      });
      setTimeout(onClose, c ? 4000 : 1200);
    } catch (err: unknown) {
      setFeedback({ type: "error", message: err instanceof Error ? err.message : "Failed to simulate reply" });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-surface rounded-xl border border-line shadow-xl w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-line">
          <div>
            <h2 className="text-base font-semibold text-ink">Simulate an inbound reply</h2>
            <p className="text-xs text-muted mt-0.5">Free — no API keys. Mimics a lead replying on any channel.</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-soft cursor-pointer">
            <X className="w-4 h-4 text-muted" />
          </button>
        </div>
        <div className="p-5 space-y-3">
          <label className="block">
            <span className="text-xs font-medium text-muted">Lead</span>
            {leadId ? (
              <div className="mt-1 flex items-center justify-between px-3 py-2 text-sm border border-line rounded-lg bg-page">
                <span className="text-ink">{leadLabel}</span>
                <button
                  onClick={() => {
                    setLeadId(null);
                    setLeadLabel("");
                  }}
                  className="text-xs text-brand cursor-pointer"
                >
                  Change
                </button>
              </div>
            ) : (
              <>
                <input
                  type="text"
                  value={leadSearch}
                  onChange={(e) => setLeadSearch(e.target.value)}
                  placeholder="Search leads by name, email, company..."
                  className="mt-1 w-full px-3 py-2 text-sm border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
                />
                {leadSearch && leads && leads.length > 0 && (
                  <div className="mt-1 max-h-40 overflow-y-auto border border-line rounded-lg divide-y divide-line">
                    {leads.slice(0, 8).map((l) => (
                      <button
                        key={l.id}
                        onClick={() => {
                          setLeadId(l.id);
                          setLeadLabel(l.name || l.email || l.phone || "Unnamed lead");
                        }}
                        className="flex w-full items-center justify-between px-3 py-2 text-xs text-left hover:bg-soft cursor-pointer"
                      >
                        <span className="text-ink">{l.name || l.email || l.phone || "Unnamed"}</span>
                        <span className="text-muted">{l.company}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </label>
          <label className="block">
            <span className="text-xs font-medium text-muted">Channel</span>
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value as (typeof CHANNELS)[number])}
              className="mt-1 w-full px-3 py-2 text-sm border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
            >
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {formatLabel(c)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-muted">
              Message text{eventType === "AUTO" ? "" : " (optional)"}
            </span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={2}
              placeholder="What the lead said..."
              className="mt-1 w-full px-3 py-2 text-sm border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-muted">Reply type</span>
            <select
              value={eventType}
              onChange={(e) => setEventType(e.target.value as typeof eventType)}
              className="mt-1 w-full px-3 py-2 text-sm border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
            >
              <option value="AUTO">Auto-detect from message text (recommended)</option>
              <option value="QUESTION">Question (creates a follow-up)</option>
              <option value="POSITIVE_REPLY">Positive reply</option>
              <option value="NEGATIVE_REPLY">Negative reply</option>
              <option value="OPT_OUT">Opt-out</option>
              <option value="UNKNOWN">Unclear / needs review</option>
            </select>
            {eventType === "AUTO" && (
              <p className="text-[11px] text-muted mt-1">
                Relay's reply classifier reads the message text and picks the type automatically — the same free,
                keyless logic a real inbound reply would go through.
              </p>
            )}
          </label>
          {feedback && (
            <p className={cn("text-xs flex items-center gap-1.5", feedback.type === "success" ? "text-ok" : "text-danger")}>
              {feedback.type === "success" ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
              {feedback.message}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose} className="px-4 py-2 text-sm font-medium border border-line rounded-lg hover:bg-soft cursor-pointer">
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={simulate.isPending}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-brand text-white rounded-lg hover:bg-brand-strong transition-colors cursor-pointer disabled:opacity-50"
            >
              {simulate.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Send simulated reply
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const CLASSIFICATION_STYLES: Record<string, { label: string; icon: typeof ThumbsUp; className: string }> = {
  POSITIVE_REPLY: { label: "Positive", icon: ThumbsUp, className: "bg-ok-light text-ok" },
  NEGATIVE_REPLY: { label: "Negative", icon: ThumbsDown, className: "bg-danger-light text-danger" },
  QUESTION: { label: "Question", icon: HelpCircle, className: "bg-brand-light text-brand" },
  OPT_OUT: { label: "Opted out", icon: Ban, className: "bg-danger-light text-danger" },
  UNKNOWN: { label: "Unclear", icon: ShieldAlert, className: "bg-warn-light text-warn" },
};

function ClassificationBadge({
  eventType,
  confidence,
}: {
  eventType: string;
  confidence: "HIGH" | "MEDIUM" | "LOW" | null;
}) {
  const escalated = confidence === "LOW";
  const entry = CLASSIFICATION_STYLES[eventType] ?? CLASSIFICATION_STYLES.UNKNOWN;
  const Icon = escalated ? ShieldAlert : entry.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap",
        escalated ? "bg-warn-light text-warn" : entry.className,
      )}
      title={confidence ? `${confidence.toLowerCase()} confidence` : undefined}
    >
      <Icon className="w-2.5 h-2.5" />
      {escalated ? "Needs review" : entry.label}
    </span>
  );
}

function formatLabel(s: string) {
  return s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}
