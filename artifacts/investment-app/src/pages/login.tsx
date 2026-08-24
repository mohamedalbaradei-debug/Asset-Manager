import React from "react";
import { LogIn, LogOut, Check, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

const PREMIUM_BENEFITS = [
  "AI Research Analyst report & chat on any stock",
  "Options & GEX gamma-walls, flow and Greeks",
  "Strategy backtests & portfolio stress tests",
  "Personal watchlist & holdings, synced across devices",
  "24/7 Telegram price & RSI alerts",
  "Free daily watchlist digest",
];

export default function LoginPage() {
  const { user, ready, login, register, logout } = useAuth();
  const [mode, setMode] = React.useState<"login" | "register">("login");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = mode === "login" ? await login(email, password) : await register(email, password);
    setBusy(false);
    if (!res.ok) setError(res.error ?? "Something went wrong.");
    else {
      setEmail("");
      setPassword("");
    }
  }

  if (!ready) {
    return <div className="max-w-md mx-auto py-20 text-center font-mono text-muted-foreground animate-pulse">LOADING…</div>;
  }

  if (user) {
    return (
      <div className="max-w-md mx-auto py-20 space-y-6">
        <div className="bg-card border border-border rounded-xl p-8 text-center space-y-4">
          <div className="text-4xl">✅</div>
          <h1 className="text-xl font-bold tracking-tight">You are signed in</h1>
          <p className="text-sm font-mono text-muted-foreground break-all">{user.email}</p>
          <span className="inline-block px-2 py-1 rounded text-[10px] font-mono font-bold tracking-wider bg-gradient-to-r from-amber-400 to-yellow-200 text-black">
            ★ PREMIUM
          </span>
          <button
            onClick={() => void logout()}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-md bg-secondary text-muted-foreground border border-border hover:text-foreground hover:border-muted-foreground/40 transition-colors font-mono text-sm"
          >
            <LogOut className="w-4 h-4" /> SIGN OUT
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto py-16 space-y-8">
      <div className="bg-card border border-border rounded-xl p-8 space-y-5">
        <div className="text-center space-y-1">
          <h1 className="text-xl font-bold tracking-tight font-mono uppercase">
            {mode === "login" ? "Sign in to AI_INVEST.SYS" : "Create your account"}
          </h1>
          <p className="text-xs font-mono text-muted-foreground">
            Your watchlist, alerts and analysis sync privately to your account.
          </p>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <input
            type="email"
            required
            placeholder="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full bg-secondary border border-border rounded-md px-3 py-2.5 text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:border-primary"
          />
          <input
            type="password"
            required
            minLength={8}
            placeholder="password (min 8 characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-secondary border border-border rounded-md px-3 py-2.5 text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:border-primary"
          />
          {error && <div className="text-xs font-mono text-destructive">{error}</div>}
          <button
            disabled={busy}
            className="w-full bg-primary text-primary-foreground font-mono font-bold rounded-md py-2.5 text-sm hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            {mode === "login" ? "SIGN IN" : "CREATE ACCOUNT"}
          </button>
        </form>
        <button
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError(null);
          }}
          className="text-xs font-mono text-muted-foreground hover:text-primary transition-colors w-full text-center"
        >
          {mode === "login" ? "No account? Create one →" : "Have an account? Sign in →"}
        </button>
      </div>

      <div className="bg-secondary/40 border border-border rounded-xl p-6">
        <div className="flex items-center gap-2 mb-3">
          <LogIn className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-bold font-mono uppercase tracking-wider text-foreground">
            Why sign up — Premium benefits
          </h2>
        </div>
        <ul className="space-y-2">
          {PREMIUM_BENEFITS.map((b) => (
            <li key={b} className="flex items-start gap-2 text-sm text-muted-foreground">
              <Check className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
              <span className="font-mono leading-relaxed">{b}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
