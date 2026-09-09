import { useEffect } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/app-shell";
import { AuthPage } from "@/pages/auth";
import { DashboardPage } from "@/pages/dashboard";
import { LeadsPage } from "@/pages/leads";
import { LeadDetailPage } from "@/pages/lead-detail";
import { IntelligencePage } from "@/pages/intelligence";
import { OutboundPage } from "@/pages/outbound";
import { ConversationsPage } from "@/pages/conversations";
import { ActivityPage } from "@/pages/activity";
import { SettingsPage } from "@/pages/settings";
import { useMe } from "@/hooks/use-auth";
import { setUnauthorizedHandler } from "@/lib/api";
import { Loader2 } from "lucide-react";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthGate />
    </QueryClientProvider>
  );
}

// Every page's data queries assume a signed-in session; this is the one place that assumption
// gets enforced. A session that expires mid-use (any API call 401ing) routes back here too — see
// setUnauthorizedHandler, wired below — rather than leaving individual pages showing a generic
// "couldn't load" error for what's actually a sign-out.
function AuthGate() {
  const { data: me, isLoading } = useMe();

  useEffect(() => {
    setUnauthorizedHandler(() => {
      queryClient.setQueryData(["auth", "me"], null);
    });
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-page">
        <Loader2 className="w-5 h-5 animate-spin text-muted" />
      </div>
    );
  }

  if (!me) {
    return <AuthPage />;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="leads" element={<LeadsPage />} />
          <Route path="leads/:id" element={<LeadDetailPage />} />
          <Route path="intelligence" element={<IntelligencePage />} />
          <Route path="outbound" element={<OutboundPage />} />
          <Route path="conversations" element={<ConversationsPage />} />
          <Route path="activity" element={<ActivityPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
