import React from "react";
import { LogIn, LogOut, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth-context";

export function AuthDialog({ children }: { children?: React.ReactNode }) {
  const { login, register } = useAuth();
  const [open, setOpen] = React.useState(false);
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
    if (res.ok) {
      setOpen(false);
      setEmail("");
      setPassword("");
    } else {
      setError(res.error ?? "Something went wrong.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children ?? (
          <button className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors font-mono text-sm">
            <LogIn className="w-4 h-4" /> SIGN IN
          </button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm bg-card border-border">
        <DialogHeader>
          <DialogTitle className="font-mono tracking-widest text-sm uppercase">
            {mode === "login" ? "Sign in to AI_INVEST.SYS" : "Create your account"}
          </DialogTitle>
          <DialogDescription className="font-mono text-xs">
            Your watchlist, calendar and price alerts sync to your account — private and durable.
          </DialogDescription>
        </DialogHeader>
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
          onClick={() => setMode(mode === "login" ? "register" : "login")}
          className="text-xs font-mono text-muted-foreground hover:text-primary transition-colors w-full text-center"
        >
          {mode === "login" ? "No account? Create one →" : "Have an account? Sign in →"}
        </button>
      </DialogContent>
    </Dialog>
  );
}

export function SidebarAuthBlock() {
  const { user, ready, logout } = useAuth();

  if (!ready) {
    return (
      <div className="text-xs font-mono text-muted-foreground animate-pulse">AUTH…</div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col gap-2">
        <AuthDialog />
        <ul className="text-[10px] font-mono text-muted-foreground/70 leading-relaxed space-y-0.5">
          <li>· AI Research Analyst report &amp; chat on any stock</li>
          <li>· Options &amp; GEX gamma-walls, flow &amp; Greeks</li>
          <li>· Strategy backtests &amp; portfolio stress tests</li>
          <li>· Watchlist &amp; holdings saved privately</li>
          <li>· 24/7 Telegram price &amp; RSI alerts</li>
          <li>· Free daily watchlist digest</li>
        </ul>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-mono text-foreground/80 truncate" title={user.email}>
          {user.email}
        </div>
        {user && (
          <span className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold tracking-wider bg-gradient-to-r from-amber-400 to-yellow-200 text-black">
            ★ PREMIUM
          </span>
        )}
      </div>
      <button
        onClick={() => void logout()}
        className="flex items-center justify-center gap-2 px-3 py-1.5 rounded-md bg-secondary text-muted-foreground border border-border hover:text-foreground hover:border-muted-foreground/40 transition-colors font-mono text-xs"
      >
        <LogOut className="w-3.5 h-3.5" /> SIGN OUT
      </button>
    </div>
  );
}
