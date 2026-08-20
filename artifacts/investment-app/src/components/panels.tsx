import React from "react";
import { Loader2, AlertTriangle, Activity } from "lucide-react";
import { cn } from "@/lib/utils";

export function SectionHeader({ title, updatedAt }: { title: string; updatedAt?: string }) {
  return (
    <div className="flex items-end justify-between border-b border-border pb-6">
      <div>
        <h1 className="text-3xl font-mono font-bold tracking-tighter">{title}</h1>
        <p className="text-muted-foreground font-mono mt-2 text-xs tracking-widest">
          REAL-TIME MARKET INTELLIGENCE
        </p>
      </div>
      {updatedAt && (
        <div className="text-xs font-mono text-muted-foreground flex items-center gap-2">
          <Activity className="w-3 h-3 text-primary" />
          UPDATED: {new Date(updatedAt).toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-mono text-sm font-bold tracking-widest text-muted-foreground mb-4">
      {children}
    </h2>
  );
}

export function LoadingState() {
  return (
    <div className="flex justify-center items-center py-32">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  );
}

export function ErrorState({ message }: { message?: string }) {
  return (
    <div className="flex justify-center items-center py-24">
      <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-6 flex items-start gap-4 max-w-lg">
        <AlertTriangle className="w-6 h-6 text-destructive shrink-0 mt-0.5" />
        <div>
          <h3 className="font-mono font-bold text-destructive">DATA UNAVAILABLE</h3>
          <p className="text-muted-foreground font-mono text-sm mt-1">
            {message ?? "Could not load data. Please try again."}
          </p>
        </div>
      </div>
    </div>
  );
}

export function statusColor(status?: string | null) {
  switch (status?.toLowerCase()) {
    case "bullish":
    case "buy":
    case "strong buy":
    case "undervalued":
    case "amplifying":
    case "oversold":
      return "text-green-500 bg-green-500/10 border border-green-500/20";
    case "bearish":
    case "sell":
    case "strong sell":
    case "overvalued":
    case "fading":
    case "overbought":
      return "text-destructive bg-destructive/10 border border-destructive/20";
    case "neutral":
    case "hold":
      return "text-yellow-500 bg-yellow-500/10 border border-yellow-500/20";
    default:
      return "text-muted-foreground bg-secondary border border-border";
  }
}

export function StatusBadge({ status }: { status?: string | null }) {
  if (!status) return null;
  return (
    <span
      className={cn(
        "px-2.5 py-1 rounded text-[10px] font-mono font-bold uppercase tracking-wider border",
        statusColor(status)
      )}
    >
      {status}
    </span>
  );
}

export function DataTile({
  label,
  value,
  status,
  hint,
}: {
  label: string;
  value?: React.ReactNode;
  status?: string | null;
  hint?: string;
}) {
  return (
    <div className="bg-card border border-border p-4 rounded-xl flex flex-col justify-between gap-3">
      <div className="text-xs text-muted-foreground font-mono">{label}</div>
      <div className="flex items-end justify-between gap-2">
        <div className="font-mono text-xl font-bold">{value ?? "—"}</div>
        <StatusBadge status={status} />
      </div>
      {hint && <div className="text-[10px] font-mono text-muted-foreground leading-relaxed">{hint}</div>}
    </div>
  );
}

export function EmptyNote({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center py-10 border border-dashed border-border rounded-xl text-muted-foreground font-mono text-xs">
      {text}
    </div>
  );
}

export function Card({ title, children, className }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("bg-card border border-border rounded-xl p-6", className)}>
      {title && (
        <h2 className="font-mono text-sm font-bold tracking-widest text-muted-foreground border-b border-border pb-3 mb-4">
          {title}
        </h2>
      )}
      {children}
    </div>
  );
}

export function pctColor(v: number | null | undefined) {
  if (v == null) return "text-muted-foreground";
  return v >= 0 ? "text-green-500" : "text-destructive";
}

export function fmtPct(v: number | null | undefined, digits = 2) {
  if (v == null) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

export function fmtNum(v: number | null | undefined, digits = 2) {
  if (v == null) return "—";
  return v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}