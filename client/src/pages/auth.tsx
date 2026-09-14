import { AvailabilityNotice } from "@/components/availability-notice";
import { isServiceUnavailable, isComingSoon } from "@/lib/api";
import { useState } from "react";
import { ArrowUpRight, Loader2, AlertCircle } from "lucide-react";
import { useLogin, useRegister } from "@/hooks/use-auth";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/brand-mark";

type Mode = "login" | "register";

export function AuthPage({ initialMode = "login" }: { initialMode?: Mode } = {}) {
  const [mode, setMode] = useState<Mode>(initialMode);

  return (
    <div className="min-h-screen w-full self-start bg-page px-5 py-6 sm:px-10 lg:px-16">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 border-b border-line pb-6">
        <a href="/" aria-label="Relay home" className="inline-flex items-center gap-3 text-ink"><BrandMark className="h-8 w-8 text-brand" /><span className="text-[26px] font-semibold tracking-[-0.06em]">Relay<span className="text-brand">.</span></span></a>
        <a href="/#example" className="inline-flex min-h-11 items-center gap-2 text-[11px] font-semibold text-ink hover:text-brand">Explore the product<ArrowUpRight className="h-4 w-4" aria-hidden="true" /></a>
      </header>
      <main className="mx-auto grid w-full max-w-6xl items-center gap-12 py-10 sm:py-16 lg:min-h-[calc(100svh-160px)] lg:grid-cols-[1fr_440px] lg:gap-20">
        <section className="hidden max-w-lg lg:block" aria-label="About your workspace">
          <p className="mb-8 text-[10px] font-semibold uppercase tracking-[0.15em] text-muted">AI Lead Intelligence &amp; Outbound Automation</p>
          <h2 className="font-display text-[64px] font-normal leading-[0.98] tracking-[-0.045em] text-ink">Good follow-up<br />starts with<br /><span className="text-brand">understanding.</span></h2>
          <p className="mt-7 max-w-sm text-sm leading-7 text-muted">Bring your enquiries into focus. See what matters, decide what comes next, and review every message before it goes out.</p>
          <ol className="mt-12 max-w-sm divide-y divide-line border-y border-line text-xs">
            {[["01", "Know the context"], ["02", "Choose the next step"], ["03", "Follow through, with review"]].map(([number, label]) => <li key={number} className="flex items-center gap-5 py-4"><span className="text-[10px] tabular-nums text-brand">{number}</span><span className="font-medium text-ink">{label}</span></li>)}
          </ol>
        </section>
        <div className="mx-auto w-full max-w-[440px]">
          <p className="mb-5 text-[10px] leading-relaxed text-muted lg:hidden">AI Lead Intelligence &amp; Outbound Automation</p>
          <div className="border border-line bg-surface p-6 sm:p-9">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-brand">Your workspace</p>
            <h1 className="font-display text-[38px] font-normal leading-tight tracking-[-0.035em] text-ink">{mode === "login" ? "Welcome back." : "A clearer next step."}</h1>
            <p className="mb-7 mt-3 text-xs leading-6 text-muted">{mode === "login" ? "Sign in to pick up where you left off." : "Create a workspace for your business and its enquiries."}</p>
            <div className="mb-7 flex gap-5 border-b border-line">
              <button type="button" aria-pressed={mode === "login"} onClick={() => setMode("login")} className={cn("min-h-11 border-b-2 pb-3 text-xs font-semibold transition-colors cursor-pointer", mode === "login" ? "border-brand text-brand" : "border-transparent text-muted hover:text-ink")}>Sign in</button>
              <button type="button" aria-pressed={mode === "register"} onClick={() => setMode("register")} className={cn("min-h-11 border-b-2 pb-3 text-xs font-semibold transition-colors cursor-pointer", mode === "register" ? "border-brand text-brand" : "border-transparent text-muted hover:text-ink")}>Create workspace</button>
            </div>
            {mode === "login" ? <LoginForm /> : <RegisterForm onDone={() => setMode("login")} />}
            {mode === "login" && <p className="mt-6 text-xs"><a className="text-muted underline decoration-line underline-offset-4 hover:text-brand" href="/recover">Recover with an offline code</a></p>}
          </div>
          <p className="mt-5 text-center text-[11px] leading-6 text-muted"><a href="/product-information" className="underline decoration-line underline-offset-4 hover:text-brand">Privacy and support</a></p>
        </div>
      </main>
    </div>
  );
}

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const login = useLogin();
  const [unavailable, setUnavailable] = useState<unknown>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await login.mutateAsync({ email: email.trim(), password });
    } catch (err) {
      if (isServiceUnavailable(err)) { setPassword(""); setUnavailable(err); return; }
      setError(err instanceof ApiError ? String(err.body && (err.body as { error?: string }).error || "Sign in failed") : "Sign in failed");
    }
  };

  if (unavailable) return <AvailabilityNotice compact source="SIGNIN" contact={{ email }} comingSoon={isComingSoon(unavailable)} uncertainAccount onRetry={() => window.location.reload()}/>;
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field label="Email">
        <input
          type="email"
          required
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          className="w-full min-h-11 px-3 py-2.5 text-sm border border-line rounded-md bg-surface text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/15 focus:border-brand"
        />
      </Field>
      <Field label="Password">
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          className="w-full min-h-11 px-3 py-2.5 text-sm border border-line rounded-md bg-surface text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/15 focus:border-brand"
        />
      </Field>
      {error && <ErrorNote message={error} />}
      <button
        type="submit"
        disabled={login.isPending}
        className="w-full min-h-11 flex items-center justify-center gap-2 py-3 text-xs font-semibold bg-brand text-white rounded-md hover:bg-brand-strong transition-colors cursor-pointer disabled:opacity-50"
      >
        {login.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
        Sign in
      </button>
    </form>
  );
}

function RegisterForm({ onDone }: { onDone: () => void }) {
  const [organizationName, setOrganizationName] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const register = useRegister();
  const [unavailable, setUnavailable] = useState<unknown>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await register.mutateAsync({
        organization_name: organizationName.trim(),
        name: name.trim(),
        email: email.trim(),
        password,
      });
    } catch (err) {
      if (isServiceUnavailable(err)) { setPassword(""); setUnavailable(err); return; }
      setError(err instanceof ApiError ? String(err.body && (err.body as { error?: string }).error || "Could not create workspace") : "Could not create workspace");
    }
  };

  if (unavailable) return <AvailabilityNotice compact source="SIGNUP" contact={{ email, name, company: organizationName }} comingSoon={isComingSoon(unavailable)} uncertainAccount onRetry={() => window.location.reload()}/>;
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field label="Workspace name">
        <input
          required
          autoFocus
          value={organizationName}
          onChange={(e) => setOrganizationName(e.target.value)}
          placeholder="Acme Furniture"
          className="w-full min-h-11 px-3 py-2.5 text-sm border border-line rounded-md bg-surface text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/15 focus:border-brand"
        />
      </Field>
      <Field label="Your name">
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Jordan Lee"
          className="w-full min-h-11 px-3 py-2.5 text-sm border border-line rounded-md bg-surface text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/15 focus:border-brand"
        />
      </Field>
      <Field label="Email">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          className="w-full min-h-11 px-3 py-2.5 text-sm border border-line rounded-md bg-surface text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/15 focus:border-brand"
        />
      </Field>
      <Field label="Password" hint="At least 8 characters">
        <input
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          className="w-full min-h-11 px-3 py-2.5 text-sm border border-line rounded-md bg-surface text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/15 focus:border-brand"
        />
      </Field>
      {error && <ErrorNote message={error} />}
      <button
        type="submit"
        disabled={register.isPending}
        className="w-full min-h-11 flex items-center justify-center gap-2 py-3 text-xs font-semibold bg-brand text-white rounded-md hover:bg-brand-strong transition-colors cursor-pointer disabled:opacity-50"
      >
        {register.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
        Create workspace
      </button>
      <button type="button" onClick={onDone} className="min-h-11 w-full text-xs text-muted hover:text-ink cursor-pointer">
        Already have a workspace? Sign in instead
      </button>
    </form>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="text-[11px] text-muted mt-1.5 block">{hint}</span>}
    </label>
  );
}

function ErrorNote({ message }: { message: string }) {
  return (
    <p role="alert" className="flex items-center gap-1.5 text-xs text-danger">
      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
      {message}
    </p>
  );
}
