import {EmailVerification} from "@/components/email-verification";
import { ChannelSetup } from "@/components/channel-setup";
import { useDeveloperToolsEnabled, useMe } from "@/hooks/use-auth";
import { AnalysisControls } from "@/components/analysis-controls";
import { useSearchParams } from "react-router-dom";
import { useState } from "react";
import {
  Settings,
  Building2,
  Brain,
  Mail,
  MessageCircle,
  Smartphone,
  PhoneCall,
  Send,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { Header } from "@/components/layout/header";
import { EmptyState } from "@/components/ui/empty-state";
import { useWorkspaceStore } from "@/stores/workspace";
import { useSettings, useUpdateSettings } from "@/hooks/use-settings";
import { cn } from "@/lib/utils";

type Tab = "ai" | "email" | "whatsapp" | "sms" | "telegram" | "call";

const TABS: { id: Tab; label: string; icon: typeof Settings }[] = [
  { id: "ai", label: "AI usage & provider", icon: Brain },
  { id: "email", label: "Email", icon: Mail },
  { id: "whatsapp", label: "WhatsApp", icon: MessageCircle },
  { id: "sms", label: "SMS", icon: Smartphone },
  { id: "telegram", label: "Telegram", icon: Send },
  { id: "call", label: "Call", icon: PhoneCall },
];

export function DeveloperToolsPage() {
  const allowed = useDeveloperToolsEnabled();
  const org = useWorkspaceStore((s) => s.currentOrg);
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: Tab = TABS.find(item => item.id === searchParams.get("tab"))?.id || "email";
  const setTab = (next: Tab) => setSearchParams({ tab: next });

  if (!allowed) return <main className="p-8"><h1 className="text-xl font-semibold">Developer tools unavailable</h1><p className="mt-3">This screen is not enabled for this session.</p><a href="/settings" className="mt-4 inline-block underline">Return to settings</a></main>;
  if (!org) {
    return (
      <>
        <Header title="Settings" />
        <EmptyState
          icon={Building2}
          title="No workspace selected"
          description="Select or create a workspace first."
        />
      </>
    );
  }

  return (
    <main className="flex h-dvh w-full flex-col overflow-hidden">
      <Header title="Developer tools" description={org.name + " / Technical configuration and diagnostics"} />
      <div className="flex-1 flex flex-col md:flex-row min-w-0 overflow-hidden">
        {/* Tab sidebar */}
        <nav aria-label="Settings sections" className="flex md:block w-full md:w-52 shrink-0 overflow-x-auto border-b md:border-b-0 md:border-r border-line bg-surface p-3 gap-1 md:space-y-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 shrink-0 md:w-full whitespace-nowrap px-3 py-2 text-sm font-medium rounded-lg transition-colors cursor-pointer",
                tab === t.id
                  ? "bg-brand-light text-brand"
                  : "text-muted hover:text-ink hover:bg-soft",
              )}
            >
              <t.icon className="w-4 h-4 shrink-0" />
              {t.label}
            </button>
          ))}
        </nav>

        {/* Content */}
        <div className="flex-1 min-w-0 overflow-y-auto p-4 sm:p-6">
          {tab === "ai" && <div className="space-y-8"><AnalysisControls /><AiSettings /></div>}
          {tab === "email" && <><ChannelSetup /><EmailVerification /></>}
          {tab === "whatsapp" && <ChannelSettings channel="whatsapp" />}
          {tab === "sms" && <ChannelSettings channel="sms" />}
          {tab === "telegram" && <ChannelSettings channel="telegram" />}
          {tab === "call" && <ChannelSettings channel="call" />}
        </div>
      </div>
    </main>
  );
}

function AiSettings() {
  const { data } = useSettings();
  const ai = data?.ai_status;

  return (
    <SettingsSection
      title="AI Provider"
      description="Review the provider used to select recorded facts and help interpret replies."
    >
      <div className={cn(
        "flex items-start gap-3 p-4 rounded-lg border",
        ai?.configured ? "border-ok bg-ok-light" : "border-warn bg-warn-light",
      )}>
        {ai?.configured ? (
          <CheckCircle2 className="w-5 h-5 text-ok shrink-0 mt-0.5" />
        ) : (
          <AlertCircle className="w-5 h-5 text-warn shrink-0 mt-0.5" />
        )}
        <div>
          <p className="text-sm font-medium text-ink">
            {ai?.configured ? `Configured: ${ai.provider} (${ai.model})` : "Not configured"}
          </p>
          <p className="text-xs text-muted mt-1">
            {ai?.configured
              ? "AI can select recorded facts and suggest reply categories. Recommendations, plans and drafts use application rules."
              : "Using recorded facts and application rules. Configure a provider to add AI evidence selection and reply interpretation."}
          </p>
        </div>
      </div>

      <p className="text-xs text-muted mt-3">
        Review source values and drafts before use. Evidence references do not independently verify that a claim is true.
      </p>

      <div className="mt-4 space-y-3">
        <p className="text-sm font-medium text-ink">Supported Providers</p>
        <div className="grid grid-cols-2 gap-3">
          <ProviderCard
            name="Groq"
            description="Free tier available. Fast inference."
            envVar="GROQ_API_KEY"
            active={ai?.provider === "groq"}
            link="https://console.groq.com"
          />
          <ProviderCard
            name="OpenAI"
            description="GPT-4o and GPT-4o-mini."
            envVar="OPENAI_API_KEY"
            active={ai?.provider === "openai"}
            link="https://platform.openai.com"
          />
          <ProviderCard
            name="OpenRouter"
            description="Access multiple models via one API."
            envVar="OPENROUTER_API_KEY"
            active={ai?.provider === "openrouter"}
            link="https://openrouter.ai"
          />
          <ProviderCard
            name="Ollama"
            description="Run models locally. No API key needed."
            envVar="OLLAMA_API_KEY"
            active={ai?.provider === "ollama"}
            link="https://ollama.ai"
          />
        </div>
        <div className="p-3 bg-soft rounded-lg border border-line">
          <p className="text-xs text-muted">
            <span className="font-semibold text-ink">Setup:</span> Set{" "}
            <code className="px-1 py-0.5 bg-surface rounded text-[10px]">LLM_PROVIDER=groq</code>{" "}
            and{" "}
            <code className="px-1 py-0.5 bg-surface rounded text-[10px]">GROQ_API_KEY=your-key</code>{" "}
            as environment variables, then restart the server.
          </p>
        </div>
      </div>
    </SettingsSection>
  );
}

function ProviderCard({
  name,
  description,
  envVar,
  active,
  link,
}: {
  name: string;
  description: string;
  envVar: string;
  active: boolean;
  link: string;
}) {
  return (
    <div className={cn(
      "p-3 rounded-lg border transition-colors",
      active ? "border-brand bg-brand-light" : "border-line bg-surface",
    )}>
      <div className="flex items-center gap-2">
        <p className="text-sm font-semibold text-ink">{name}</p>
        {active && (
          <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-brand text-white">
            Active
          </span>
        )}
      </div>
      <p className="text-[11px] text-muted mt-1">{description}</p>
      <p className="text-[10px] text-muted mt-1.5">
        Env: <code className="text-[10px]">{envVar}</code>
      </p>
      <a
        href={link}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[10px] text-brand hover:underline mt-1 inline-block"
      >
        Get API key
      </a>
    </div>
  );
}

const CHANNEL_CONFIG: Record<string, { title: string; providers: { value: string; label: string }[] }> = {
  whatsapp: { title: "WhatsApp", providers: [{ value: "meta", label: "Meta WhatsApp Business API" }] },
  sms: { title: "SMS", providers: [{ value: "twilio", label: "Twilio" }] },
  telegram: { title: "Telegram", providers: [{ value: "telegram_bot", label: "Telegram Bot API" }] },
  call: { title: "Call", providers: [{ value: "twilio_voice", label: "Twilio Voice" }, { value: "livekit", label: "LiveKit" }] },
};
function ChannelSettings({ channel }: { channel: string }) {
  const org = useWorkspaceStore(s => s.currentOrg), { data: me } = useMe();
  const query = useSettings(), config = CHANNEL_CONFIG[channel];
  if (!org || me?.user.role !== "OWNER" || me.user.organization_id !== org.id) return <p className="text-sm text-muted">A current workspace owner can manage channel settings.</p>;
  if (!query.data) return <SettingsSection title={config.title + " channel"} description="Live operation is unavailable for this channel."><p role="status">{query.isError ? "Saved settings could not be loaded." : "Loading channel settings..."}</p>{query.isError && <button type="button" onClick={() => void query.refetch()}>Try again</button>}</SettingsSection>;
  return <UnsupportedChannel key={org.id + ":" + channel} channel={channel} stored={query.data.settings["channel_" + channel] || {}} />;
}
function UnsupportedChannel({ channel, stored }: { channel: string; stored: Record<string, unknown> }) {
  const config = CHANNEL_CONFIG[channel], update = useUpdateSettings();
  const savedProvider = typeof stored.provider === "string" ? stored.provider : "sandbox";
  const [provider, setProvider] = useState(savedProvider), [saved, setSaved] = useState(false);
  return <SettingsSection title={config.title + " channel"} description="Sandbox simulation is available. Supported live send, reply and policy handling for this channel has not been released.">
    <p className="text-sm text-muted">Saved provider: {savedProvider === "sandbox" ? "Sandbox" : (config.providers.find(item => item.value === savedProvider)?.label || savedProvider) + " (unsupported live configuration retained)"}. Existing credentials are not displayed or replaced here.</p>
    <FieldGroup label="Channel mode" htmlFor={channel + "-mode"}><select id={channel + "-mode"} value={provider} onChange={event => { setProvider(event.target.value); setSaved(false); }} className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"><option value="sandbox">Sandbox — simulated only</option>{config.providers.map(item => <option key={item.value} value={item.value} disabled>{item.label} — live operation unavailable</option>)}{savedProvider !== "sandbox" && !config.providers.some(item => item.value === savedProvider) && <option value={savedProvider} disabled>{savedProvider} — stored unsupported provider</option>}</select></FieldGroup>
    <p className="text-sm text-muted">Selecting and saving Sandbox is an explicit mode change. It delivers no real messages or calls. Saving does not erase retained provider credentials or enable live sending.</p>
    {update.isError && <p role="alert" className="text-sm text-warn">The mode change could not be confirmed. Check saved settings before retrying.</p>}
    <button type="button" disabled={provider !== "sandbox" || update.isPending} className="rounded-lg border border-line px-3 py-2 text-sm disabled:opacity-50" onClick={async () => { try { await update.mutateAsync({ category: "channel_" + channel, values: { provider: "sandbox" } }); setSaved(true); } catch { setSaved(false); } }}>Save Sandbox mode</button>
    {saved && <p role="status" className="text-sm text-ok">Sandbox mode saved. Live operation remains unavailable.</p>}
  </SettingsSection>;
}

function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="max-w-2xl">
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      <p className="text-sm text-muted mt-1 mb-6">{description}</p>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function FieldGroup({ label, children, htmlFor }: { label: string; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-ink mb-1.5">{label}</label>
      {children}
    </div>
  );
}
