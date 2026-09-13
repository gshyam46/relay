import { CustomerChannel } from "@/components/customer-channel";
import {WorkspaceData} from "@/components/workspace-data";
import {OperationsStatus} from "@/components/operations-status";
import {AccountSecurity} from "@/components/account-security";
import { AnalysisControls } from "@/components/analysis-controls";
import { FitCriteriaEditor } from "@/components/fit-criteria";
import { useSearchParams } from "react-router-dom";
import { BusinessProfile } from "@/components/business-profile";
import { DispatchControls } from "@/components/dispatch-controls";
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
  Loader2,
} from "lucide-react";
import { Header } from "@/components/layout/header";
import { EmptyState } from "@/components/ui/empty-state";
import { useWorkspaceStore } from "@/stores/workspace";
import { useSettings, useUpdateSettings } from "@/hooks/use-settings";
import { cn } from "@/lib/utils";

type Tab = "data" | "operations" | "security" | "fit" | "business" | "sending" | "general" | "ai" | "email" | "whatsapp" | "sms" | "telegram" | "call";

const TABS: { id: Tab; label: string; icon: typeof Settings }[] = [
  { id: "operations", label: "Operations", icon: Settings },
  { id: "security", label: "Account security", icon: Settings },
  { id: "data", label: "Workspace data", icon: Settings },
  { id: "business", label: "Business profile", icon: Building2 },
  { id: "fit", label: "Fit criteria", icon: Brain },
  { id: "general", label: "General", icon: Building2 },
  { id: "sending", label: "Sending controls", icon: Send },
  { id: "ai", label: "AI assistance", icon: Brain },
  { id: "email", label: "Email", icon: Mail },
  { id: "whatsapp", label: "WhatsApp", icon: MessageCircle },
  { id: "sms", label: "SMS", icon: Smartphone },
  { id: "telegram", label: "Telegram", icon: Send },
  { id: "call", label: "Call", icon: PhoneCall },
];

export function SettingsPage() {
  const org = useWorkspaceStore((s) => s.currentOrg);
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: Tab = TABS.find(item => item.id === searchParams.get("tab"))?.id || "business";
  const setTab = (next: Tab) => setSearchParams(next === "business" ? {} : { tab: next });

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
          {tab === "security" && <AccountSecurity/>}
          {tab === "data" && <WorkspaceData/>}
          {tab === "business" && <BusinessProfile />}
          {tab === "fit" && <FitCriteriaEditor />}
          {tab === "general" && <GeneralSettings />}
          {tab === "sending" && <DispatchControls />}
          {tab === "ai" && <div className="space-y-8"><AiSettings /><AnalysisControls customer /></div>}
          {tab === "operations" && <OperationsStatus/>}
          {tab === "email" && <CustomerChannel channel="email" />}
          {tab === "whatsapp" && <CustomerChannel channel="whatsapp" />}
          {tab === "sms" && <CustomerChannel channel="sms" />}
          {tab === "telegram" && <CustomerChannel channel="telegram" />}
          {tab === "call" && <CustomerChannel channel="call" />}
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
  const query = useSettings();
  return <SettingsSection title="AI assistance" description="Understand how your enquiries are assessed.">
    {query.isError ? <p role="alert">AI availability could not be checked. <button type="button" className="underline" onClick={() => void query.refetch()}>Try again</button></p> : !query.data ? <p role="status">Checking AI availability...</p> : <><p className="text-sm font-medium">{query.data.ai_status.configured ? "AI assistance is configured" : "Using recorded facts and application rules"}</p><p className="text-sm text-muted">{query.data.ai_status.configured ? "AI can help select evidence and interpret replies. Review its suggestions before acting." : "You can assess enquiries using their recorded information. Additional AI assistance is not connected in this environment."}</p><p className="text-sm text-muted">Recommendations, plans and drafts follow application rules. Review the source information and exact message before approving an action.</p></>}
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
