import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity } from "lucide-react";
import { cn } from "@/lib/utils";

interface VixData {
  vix: number | null;
  signal: "bullish" | "neutral" | "bearish";
  band: string;
  meaning: string;
  hint: string;
  updatedAt?: string;
}

async function fetchVix(): Promise<VixData> {
  const r = await fetch("/api/vix");
  if (!r.ok) throw new Error("Failed to load VIX");
  return r.json();
}

const SIGNAL_STYLES: Record<VixData["signal"], { badge: string; dot: string; label: string }> = {
  bullish: { badge: "bg-green-500/15 text-green-400 border-green-500/40", dot: "bg-green-500", label: "Bullish" },
  neutral: { badge: "bg-amber-500/15 text-amber-400 border-amber-500/40", dot: "bg-amber-500", label: "Neutral" },
  bearish: { badge: "bg-red-500/15 text-red-400 border-red-500/40", dot: "bg-red-500", label: "Bearish" },
};

export function VixGauge({ variant = "sidebar" }: { variant?: "sidebar" | "panel" }) {
  const { data, isPending, isError } = useQuery({
    queryKey: ["vix"],
    queryFn: fetchVix,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  if (isPending) {
    return (
      <div className={cn("bg-card border border-border rounded-xl animate-pulse", variant === "panel" ? "p-5" : "p-4")}>
        <div className="h-3 w-28 bg-secondary rounded mb-3" />
        <div className="h-8 w-20 bg-secondary rounded" />
      </div>
    );
  }
  if (isError || !data) return null;

  const s = SIGNAL_STYLES[data.signal];
  const compact = variant === "sidebar";

  return (
    <div className={cn("bg-card border border-border rounded-xl", compact ? "p-4" : "p-5")}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" />
          <span className="font-mono text-[11px] font-bold tracking-widest text-muted-foreground">
            VIX · FEAR GAUGE
          </span>
        </div>
        <span className={cn("px-2 py-0.5 rounded text-[10px] font-mono border flex items-center gap-1", s.badge)}>
          <span className={cn("w-1.5 h-1.5 rounded-full", s.dot)} />
          {s.label}
        </span>
      </div>

      <div className="flex items-end gap-2">
        <span className="text-3xl font-mono font-black tabular-nums">
          {data.vix != null ? data.vix.toFixed(2) : "—"}
        </span>
        <span className="text-xs text-muted-foreground mb-1">{data.band}</span>
      </div>

      <p className={cn("text-sm text-foreground/90 mt-2", compact && "line-clamp-2")}>{data.meaning}</p>

      {!compact && (
        <p className="text-xs text-muted-foreground mt-3 border-t border-border pt-3 leading-relaxed">
          <span className="font-semibold text-foreground/80">What this means for beginners: </span>
          {data.hint}
        </p>
      )}
    </div>
  );
}
