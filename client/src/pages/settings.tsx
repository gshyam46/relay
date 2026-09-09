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
  Save,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Eye,
  EyeOff,
  Copy,
  Webhook,
} from "lucide-react";
import { Header } from "@/components/layout/header";
import { EmptyState } from "@/components/ui/empty-state";
import { useWorkspaceStore } from "@/stores/workspace";
import { useSettings, useUpdateSettings, useEmailWebhooks } from "@/hooks/use-settings";
import { cn } from "@/lib/utils";

type Tab = "general" | "ai" | "email" | "whatsapp" | "sms" | "telegram" | "call";

const TABS: { id: Tab; label: string; icon: typeof Settings }[] = [
  { id: "general", label: "General", icon: Building2 },
  { id: "ai", label: "AI Provider", icon: Brain },
  { id: "email", label: "Email", icon: Mail },
  { id: "whatsapp", label: "WhatsApp", icon: MessageCircle },
  { id: "sms", label: "SMS", icon: Smartphone },
  { id: "telegram", label: "Telegram", icon: Send },
  { id: "call", label: "Call", icon: PhoneCall },
];

export function SettingsPage() {
  const org = useWorkspaceStore((s) => s.currentOrg);
  const [tab, setTab] = useState<Tab>("general");

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
    <>
      <Header title="Settings" description={org.name} />
      <div className="flex-1 flex overflow-hidden">
        {/* Tab sidebar */}
        <nav className="w-52 shrink-0 border-r border-line bg-surface p-3 space-y-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex items-center gap-2.5 w-full px-3 py-2 text-sm font-medium rounded-lg transition-colors cursor-pointer",
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
        <div className="flex-1 overflow-y-auto p-6">
          {tab === "general" && <GeneralSettings />}
          {tab === "ai" && <AiSettings />}
          {tab === "email" && <ChannelSettings channel="email" />}
          {tab === "whatsapp" && <ChannelSettings channel="whatsapp" />}
          {tab === "sms" && <ChannelSettings channel="sms" />}
          {tab === "telegram" && <ChannelSettings channel="telegram" />}
          {tab === "call" && <ChannelSettings channel="call" />}
        </div>
      </div>
    </>
  );
}

function GeneralSettings() {
  const { data } = useSettings();
  const update = useUpdateSettings();
  const general = data?.settings?.general || {};
  const [industry, setIndustry] = useState(general.industry as string || "");
  const [timezone, setTimezone] = useState(general.timezone as string || "UTC");
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    await update.mutateAsync({
      category: "general",
      values: { industry, timezone },
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <SettingsSection
      title="General Settings"
      description="Configure your workspace basics."
    >
      <FieldGroup label="Industry / Vertical">
        <select
          value={industry}
          onChange={(e) => setIndustry(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-brand/30"
        >
          <option value="">Not specified</option>
          <option value="real_estate">Real Estate</option>
          <option value="furniture">Furniture & Interior Design</option>
          <option value="saas">SaaS / Technology</option>
          <option value="construction">Construction</option>
          <option value="services">Professional Services</option>
          <option value="ecommerce">E-Commerce</option>
          <option value="healthcare">Healthcare</option>
          <option value="education">Education</option>
          <option value="other">Other</option>
        </select>
      </FieldGroup>
      <FieldGroup label="Timezone">
        <select
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-brand/30"
        >
          <option value="UTC">UTC</option>
          <option value="America/New_York">Eastern (US)</option>
          <option value="America/Chicago">Central (US)</option>
          <option value="America/Denver">Mountain (US)</option>
          <option value="America/Los_Angeles">Pacific (US)</option>
          <option value="Europe/London">London</option>
          <option value="Europe/Berlin">Berlin</option>
          <option value="Asia/Kolkata">India (IST)</option>
          <option value="Asia/Shanghai">China (CST)</option>
          <option value="Asia/Tokyo">Tokyo</option>
          <option value="Australia/Sydney">Sydney</option>
        </select>
      </FieldGroup>
      <SaveButton onClick={handleSave} loading={update.isPending} saved={saved} />
    </SettingsSection>
  );
}

function AiSettings() {
  const { data } = useSettings();
  const ai = data?.ai_status;

  return (
    <SettingsSection
      title="AI Provider"
      description="Configure the LLM provider for intelligence synthesis, recommendations, and message generation."
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
            {ai?.configured ? `Connected: ${ai.provider} (${ai.model})` : "Not configured"}
          </p>
          <p className="text-xs text-muted mt-1">
            {ai?.configured
              ? "AI-powered synthesis, recommendations, and message generation are active."
              : "Using deterministic local agents. Set environment variables to enable AI."}
          </p>
        </div>
      </div>

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

const CHANNEL_CONFIG: Record<string, {
  title: string;
  description: string;
  providers: { value: string; label: string; fields: { key: string; label: string; type: string; placeholder: string }[] }[];
}> = {
  email: {
    title: "Email Channel",
    description: "Configure email sending for outbound automation.",
    providers: [
      { value: "sandbox", label: "Sandbox — free, simulated, no API key needed", fields: [] },
      {
        value: "resend",
        label: "Resend",
        fields: [
          { key: "api_key", label: "API Key", type: "password", placeholder: "re_..." },
          { key: "from_email", label: "From Email", type: "email", placeholder: "hello@yourdomain.com" },
        ],
      },
      {
        value: "sendgrid",
        label: "SendGrid",
        fields: [
          { key: "api_key", label: "API Key", type: "password", placeholder: "SG...." },
          { key: "from_email", label: "From Email", type: "email", placeholder: "hello@yourdomain.com" },
        ],
      },
    ],
  },
  whatsapp: {
    title: "WhatsApp Channel",
    description: "Configure WhatsApp Business API for messaging.",
    providers: [
      { value: "sandbox", label: "Sandbox — free, simulated, no API key needed", fields: [] },
      {
        value: "meta",
        label: "Meta WhatsApp Business API",
        fields: [
          { key: "api_key", label: "Access Token", type: "password", placeholder: "EAAx..." },
          { key: "phone_number_id", label: "Phone Number ID", type: "text", placeholder: "1234567890" },
        ],
      },
    ],
  },
  sms: {
    title: "SMS Channel",
    description: "Configure SMS provider for text messages.",
    providers: [
      { value: "sandbox", label: "Sandbox — free, simulated, no API key needed", fields: [] },
      {
        value: "twilio",
        label: "Twilio",
        fields: [
          { key: "account_sid", label: "Account SID", type: "text", placeholder: "ACx..." },
          { key: "auth_token", label: "Auth Token", type: "password", placeholder: "..." },
          { key: "from_number", label: "From Number", type: "text", placeholder: "+1234567890" },
        ],
      },
    ],
  },
  telegram: {
    title: "Telegram Channel",
    description: "Configure Telegram Bot API for messaging.",
    providers: [
      { value: "sandbox", label: "Sandbox — free, simulated, no API key needed", fields: [] },
      {
        value: "telegram_bot",
        label: "Telegram Bot API",
        fields: [
          { key: "bot_token", label: "Bot Token", type: "password", placeholder: "123456:ABC-DEF..." },
          { key: "chat_id", label: "Default Chat ID (optional)", type: "text", placeholder: "-100..." },
        ],
      },
    ],
  },
  call: {
    title: "Call Channel",
    description: "Configure voice call provider for outbound and inbound calls.",
    providers: [
      { value: "sandbox", label: "Sandbox — free, simulated, no API key needed", fields: [] },
      {
        value: "twilio_voice",
        label: "Twilio Voice",
        fields: [
          { key: "account_sid", label: "Account SID", type: "text", placeholder: "ACx..." },
          { key: "auth_token", label: "Auth Token", type: "password", placeholder: "..." },
          { key: "from_number", label: "Caller ID Number", type: "text", placeholder: "+1234567890" },
        ],
      },
      {
        value: "livekit",
        label: "LiveKit (Open Source)",
        fields: [
          { key: "api_key", label: "API Key", type: "text", placeholder: "API..." },
          { key: "api_secret", label: "API Secret", type: "password", placeholder: "..." },
          { key: "server_url", label: "Server URL", type: "text", placeholder: "wss://your-livekit.example.com" },
        ],
      },
    ],
  },
};

function ChannelSettings({ channel }: { channel: string }) {
  const config = CHANNEL_CONFIG[channel];
  const { data } = useSettings();
  const update = useUpdateSettings();
  const stored = data?.settings?.[`channel_${channel}`] || {};
  const [provider, setProvider] = useState((stored.provider as string) || "sandbox");
  const [fields, setFields] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const p of config.providers) {
      for (const f of p.fields) {
        init[f.key] = (stored[f.key] as string) || "";
      }
    }
    return init;
  });
  const [saved, setSaved] = useState(false);
  const [showSecrets, setShowSecrets] = useState<Set<string>>(new Set());

  const activeProvider = config.providers.find((p) => p.value === provider);
  const isSandbox = provider === "sandbox";

  const handleSave = async () => {
    const values: Record<string, unknown> = { provider };
    if (activeProvider) {
      for (const f of activeProvider.fields) {
        if (fields[f.key]) values[f.key] = fields[f.key];
      }
    }
    await update.mutateAsync({ category: `channel_${channel}`, values });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const toggleSecret = (key: string) => {
    setShowSecrets((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <SettingsSection title={config.title} description={config.description}>
      <div className={cn(
        "flex items-center gap-2 px-3 py-2 rounded-lg border text-sm",
        isSandbox ? "border-line bg-soft text-muted" : "border-ok bg-ok-light text-ok",
      )}>
        {isSandbox ? (
          <AlertCircle className="w-4 h-4 shrink-0" />
        ) : (
          <CheckCircle2 className="w-4 h-4 shrink-0" />
        )}
        {isSandbox
          ? "Sandbox mode — fully testable for free. Actions run through this channel end-to-end, but nothing leaves Relay."
          : `Connected: ${activeProvider?.label}`}
      </div>

      <FieldGroup label="Provider">
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-brand/30"
        >
          {config.providers.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </FieldGroup>

      {activeProvider?.fields.map((f) => (
        <FieldGroup key={f.key} label={f.label}>
          <div className="relative">
            <input
              type={f.type === "password" && !showSecrets.has(f.key) ? "password" : "text"}
              value={fields[f.key] || ""}
              onChange={(e) => setFields((prev) => ({ ...prev, [f.key]: e.target.value }))}
              placeholder={f.placeholder}
              className="w-full px-3 py-2 text-sm border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-brand/30 pr-10"
            />
            {f.type === "password" && (
              <button
                type="button"
                onClick={() => toggleSecret(f.key)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted hover:text-ink cursor-pointer"
              >
                {showSecrets.has(f.key) ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            )}
          </div>
        </FieldGroup>
      ))}

      {channel === "email" && provider === "sendgrid" && <EmailWebhookInfo />}

      <SaveButton onClick={handleSave} loading={update.isPending} saved={saved} />
    </SettingsSection>
  );
}

function EmailWebhookInfo() {
  const { data, isLoading } = useEmailWebhooks(true);
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // Clipboard access can be blocked (permissions, insecure context) — the URL is still
      // visible to select and copy by hand, so this is a soft failure, not an error state.
    }
  };

  if (isLoading || !data) {
    return null;
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const rows = [
    { label: "Inbound Parse URL", hint: "Paste into SendGrid → Settings → Inbound Parse", path: data.inbound_path },
    { label: "Event Webhook URL", hint: "Paste into SendGrid → Settings → Mail Settings → Event Webhook", path: data.events_path },
  ];

  return (
    <div className="rounded-lg border border-line bg-page p-3.5 space-y-3">
      <div className="flex items-center gap-2 text-xs font-semibold text-ink">
        <Webhook className="w-3.5 h-3.5 text-brand" />
        Webhooks — connect real replies and delivery tracking
      </div>
      {rows.map((row) => (
        <div key={row.label}>
          <p className="text-[11px] text-muted mb-1">{row.hint}</p>
          <div className="flex items-center gap-1.5">
            <code className="flex-1 min-w-0 truncate px-2 py-1.5 text-[11px] bg-surface border border-line rounded-md text-ink">
              {origin}{row.path}
            </code>
            <button
              type="button"
              onClick={() => copy(row.label, `${origin}${row.path}`)}
              className="shrink-0 flex items-center gap-1 px-2 py-1.5 text-[11px] font-medium border border-line rounded-md hover:bg-soft cursor-pointer"
            >
              <Copy className="w-3 h-3" />
              {copied === row.label ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      ))}
      <p className="text-[11px] text-muted">
        This URL is unique to this workspace — keep it private the way you would an API key.
      </p>
    </div>
  );
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

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-ink mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function SaveButton({
  onClick,
  loading,
  saved,
}: {
  onClick: () => void;
  loading: boolean;
  saved: boolean;
}) {
  return (
    <div className="pt-2">
      <button
        onClick={onClick}
        disabled={loading}
        className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-brand text-white rounded-lg hover:bg-brand-strong transition-colors cursor-pointer disabled:opacity-50"
      >
        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : saved ? (
          <CheckCircle2 className="w-4 h-4" />
        ) : (
          <Save className="w-4 h-4" />
        )}
        {loading ? "Saving..." : saved ? "Saved!" : "Save Changes"}
      </button>
    </div>
  );
}
