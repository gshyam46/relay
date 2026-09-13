import { useState } from "react";
import { Zap, Loader2, AlertCircle } from "lucide-react";
import { useLogin, useRegister } from "@/hooks/use-auth";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

type Mode = "login" | "register";

export function AuthPage({ initialMode = "login" }: { initialMode?: Mode } = {}) {
  const [mode, setMode] = useState<Mode>(initialMode);

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-page px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-brand text-white">
            <Zap className="w-4.5 h-4.5" />
          </div>
          <span className="font-semibold text-lg tracking-tight text-ink">Relay</span>
        </div>

        <div className="bg-surface border border-line rounded-xl shadow-sm p-6">
          <div className="flex gap-1 p-1 mb-6 bg-soft rounded-lg">
            <button
              onClick={() => setMode("login")}
              className={cn(
                "flex-1 py-1.5 text-sm font-medium rounded-md transition-colors cursor-pointer",
                mode === "login" ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink",
              )}
            >
              Sign in
            </button>
            <button
              onClick={() => setMode("register")}
              className={cn(
                "flex-1 py-1.5 text-sm font-medium rounded-md transition-colors cursor-pointer",
                mode === "register" ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink",
              )}
            >
              Create workspace
            </button>
          </div>

          {mode === "login" ? <LoginForm /> : <RegisterForm onDone={() => setMode("login")} />}
          {mode === "login" && <p className="mt-4 text-sm"><a className="text-brand underline" href="/recover">Recover with an offline code</a></p>}
        </div>
      </div>
    </div>
  );
}

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const login = useLogin();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await login.mutateAsync({ email: email.trim(), password });
    } catch (err) {
      setError(err instanceof ApiError ? String(err.body && (err.body as { error?: string }).error || "Sign in failed") : "Sign in failed");
    }
  };

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
          className="w-full px-3 py-2 text-sm border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
        />
      </Field>
      <Field label="Password">
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          className="w-full px-3 py-2 text-sm border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
        />
      </Field>
      {error && <ErrorNote message={error} />}
      <button
        type="submit"
        disabled={login.isPending}
        className="w-full flex items-center justify-center gap-1.5 py-2 text-sm font-medium bg-brand text-white rounded-lg hover:bg-brand-strong transition-colors cursor-pointer disabled:opacity-50"
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
      setError(err instanceof ApiError ? String(err.body && (err.body as { error?: string }).error || "Could not create workspace") : "Could not create workspace");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field label="Workspace name">
        <input
          required
          autoFocus
          value={organizationName}
          onChange={(e) => setOrganizationName(e.target.value)}
          placeholder="Acme Furniture"
          className="w-full px-3 py-2 text-sm border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
        />
      </Field>
      <Field label="Your name">
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Jordan Lee"
          className="w-full px-3 py-2 text-sm border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
        />
      </Field>
      <Field label="Email">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          className="w-full px-3 py-2 text-sm border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
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
          className="w-full px-3 py-2 text-sm border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
        />
      </Field>
      {error && <ErrorNote message={error} />}
      <button
        type="submit"
        disabled={register.isPending}
        className="w-full flex items-center justify-center gap-1.5 py-2 text-sm font-medium bg-brand text-white rounded-lg hover:bg-brand-strong transition-colors cursor-pointer disabled:opacity-50"
      >
        {register.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
        Create workspace
      </button>
      <button type="button" onClick={onDone} className="w-full text-xs text-muted hover:text-ink cursor-pointer">
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
      {hint && <span className="text-[11px] text-subtle mt-1 block">{hint}</span>}
    </label>
  );
}

function ErrorNote({ message }: { message: string }) {
  return (
    <p className="flex items-center gap-1.5 text-xs text-danger">
      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
      {message}
    </p>
  );
}
