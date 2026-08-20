import React from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  Scale,
  Newspaper,
  MessageSquare,
  Gauge,
  Activity as ActivityIcon,
  Sigma,
  Globe,
  Bot,
  Send,
  Loader2,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
} from "lucide-react";
import type {
  AnalysisResult,
  SentimentReport,
  OptionsFlowResult,
  GreeksSnapshot,
  MarketInternals,
  FairValue,
} from "@workspace/api-client-react";
import { useAiChat, useGetAiStatus, getGetAiStatusQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/panels";

const fmtCurrency = (val: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(val);
const fmtCompact = (val: number | null | undefined) =>
  val == null ? "—" : new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(val);

function sentiColor(label?: string) {
  switch (label?.toLowerCase()) {
    case "bullish": return "text-green-500 bg-green-500/10 border-green-500/20";
    case "bearish": return "text-destructive bg-destructive/10 border-destructive/20";
    default: return "text-yellow-500 bg-yellow-500/10 border-yellow-500/20";
  }
}

function SentiIcon({ label }: { label?: string }) {
  switch (label?.toLowerCase()) {
    case "bullish": return <ArrowUpRight className="w-4 h-4" />;
    case "bearish": return <ArrowDownRight className="w-4 h-4" />;
    default: return <Minus className="w-4 h-4" />;
  }
}

function SectionCard({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-6">
      <h2 className="font-mono text-sm font-bold tracking-widest text-muted-foreground border-b border-border pb-3 mb-4 flex items-center gap-2">
        {icon}
        {title}
      </h2>
      {children}
    </div>
  );
}

export function FairValueSection({ fairValue }: { fairValue?: FairValue | null }) {
  if (!fairValue) return null;
  return (
    <SectionCard icon={<Scale className="w-4 h-4" />} title="FAIR VALUE">
      <div className="flex flex-wrap items-center gap-6">
        <div>
          <div className="text-xs text-muted-foreground font-mono mb-1">CONSENSUS TARGET</div>
          <div className="font-mono text-3xl font-bold">
            {fairValue.targetMeanPrice != null ? fmtCurrency(fairValue.targetMeanPrice) : "—"}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground font-mono mb-1">DIVERGENCE</div>
          <div
            className={cn(
              "font-mono text-3xl font-bold",
              (fairValue.percentDifference ?? 0) >= 0 ? "text-green-500" : "text-destructive"
            )}
          >
            {fairValue.percentDifference != null
              ? `${fairValue.percentDifference > 0 ? "+" : ""}${fairValue.percentDifference.toFixed(1)}%`
              : "—"}
          </div>
        </div>
        <StatusBadge status={fairValue.label} />
      </div>
      <p className="text-xs font-mono text-muted-foreground leading-relaxed mt-4">{fairValue.explanation}</p>
    </SectionCard>
  );
}

export function PriceVsEpsSection({
  priceVsEps,
  ticker,
}: {
  priceVsEps?: AnalysisResult["priceVsEps"];
  ticker: string;
}) {
  if (!priceVsEps || !priceVsEps.dates || priceVsEps.dates.length === 0) return null;
  const data = priceVsEps.dates.map((d, i) => ({
    date: d,
    EPS: priceVsEps.eps?.[i] ?? null,
    [ticker]: priceVsEps.price?.[i] ?? null,
  }));
  return (
    <SectionCard icon={<ActivityIcon className="w-4 h-4" />} title="PRICE vs EPS">
      <div className="h-[260px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: 0, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} />
            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} domain={["auto", "auto"]} />
            <Tooltip
              contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }}
              itemStyle={{ fontFamily: "var(--font-mono)", fontSize: "12px" }}
              labelStyle={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "hsl(var(--muted-foreground))" }}
            />
            <Legend wrapperStyle={{ fontFamily: "var(--font-mono)", fontSize: "11px" }} />
            <Line type="monotone" dataKey="EPS" stroke="#eab308" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey={ticker} name={ticker} stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </SectionCard>
  );
}

export function SentimentSection({ report }: { report?: SentimentReport | null }) {
  if (!report) return null;
  return (
    <SectionCard
      icon={report.source === "Reddit" ? <MessageSquare className="w-4 h-4" /> : <Newspaper className="w-4 h-4" />}
      title={`${report.source.toUpperCase()} SENTIMENT`}
    >
      <div className="flex flex-wrap items-center gap-6">
        <div className="font-mono text-4xl font-bold">{report.compound.toFixed(2)}</div>
        <span className={cn("px-3 py-1 rounded-md text-xs font-mono font-bold border", sentiColor(report.label))}>
          <span className="inline-flex items-center gap-1.5">
            <SentiIcon label={report.label} />
            {report.label?.toUpperCase()}
          </span>
        </span>
        {!report.available && <span className="text-xs font-mono text-muted-foreground">Unavailable</span>}
      </div>
      <p className="text-xs font-mono text-muted-foreground leading-relaxed mt-4">{report.explanation}</p>
      {report.headlines.length > 0 && (
        <ul className="space-y-2 mt-4 border-t border-border pt-4">
          {report.headlines.slice(0, 5).map((h, i) => (
            <li key={i} className="flex items-start gap-2 text-xs font-mono text-muted-foreground leading-relaxed">
              <span className={cn("mt-0.5", sentiColor(h.label))}>
                <SentiIcon label={h.label} />
              </span>
              <span className="flex-1">{h.title}</span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

export function MarketInternalsSection({ internals }: { internals?: MarketInternals | null }) {
  if (!internals) return null;
  return (
    <SectionCard icon={<Gauge className="w-4 h-4" />} title="MARKET INTERNALS">
      <div className="grid grid-cols-2 gap-6">
        <div>
          <div className="text-xs text-muted-foreground font-mono mb-1">TRIN (ARMS INDEX)</div>
          <div className="font-mono text-3xl font-bold">{internals.trin != null ? internals.trin.toFixed(2) : "—"}</div>
          <StatusBadge status={internals.trinSignal} />
        </div>
        <div>
          <div className="text-xs text-muted-foreground font-mono mb-1">LIQUIDITY (10Y YIELD)</div>
          <div className="font-mono text-3xl font-bold">{internals.tnxYield != null ? `${internals.tnxYield.toFixed(2)}%` : "—"}</div>
          <StatusBadge status={internals.liquidityAssessment} />
        </div>
      </div>
      <div className="space-y-3 mt-4 border-t border-border pt-4 text-xs font-mono text-muted-foreground leading-relaxed">
        <p>{internals.trinExplanation}</p>
        <p>{internals.liquidityExplanation}</p>
      </div>
    </SectionCard>
  );
}

export function OptionsFlowSection({ flow }: { flow?: OptionsFlowResult | null }) {
  if (!flow) return null;
  return (
    <SectionCard icon={<Sigma className="w-4 h-4" />} title="OPTIONS FLOW">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div>
          <div className="text-xs text-muted-foreground font-mono mb-1">P/C VOL RATIO</div>
          <div className="font-mono text-2xl font-bold">
            {flow.putCallVolumeRatio != null ? flow.putCallVolumeRatio.toFixed(2) : "—"}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground font-mono mb-1">CALL VOL</div>
          <div className="font-mono text-2xl font-bold">{fmtCompact(flow.totalCallVolume)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground font-mono mb-1">PUT VOL</div>
          <div className="font-mono text-2xl font-bold">{fmtCompact(flow.totalPutVolume)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground font-mono mb-1">O.I.</div>
          <div className="font-mono text-2xl font-bold">{fmtCompact(flow.totalOpenInterest)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground font-mono mb-1">SIGNAL</div>
          <StatusBadge status={flow.signal} />
        </div>
        <div>
          <div className="text-xs text-muted-foreground font-mono mb-1">PREMIUM FLOW</div>
          <div className="font-mono text-2xl font-bold">
            {flow.premiumFlow != null ? fmtCompact(flow.premiumFlow) : "—"}
          </div>
        </div>
      </div>
      {flow.unusualActivity && (
        <div className="mt-4 bg-yellow-500/10 border border-yellow-500/20 text-yellow-500 text-xs font-mono rounded-lg px-4 py-3">
          UNUSUAL ACTIVITY: {flow.unusualNote}
        </div>
      )}
      <p className="text-xs font-mono text-muted-foreground leading-relaxed mt-4">{flow.interpretation}</p>
    </SectionCard>
  );
}

export function GreeksSection({ greeks }: { greeks?: GreeksSnapshot | null }) {
  if (!greeks) return null;
  const row = (label: string, g?: { delta?: number | null; gamma?: number | null; charm?: number | null } | null) => (
    <tr>
      <td className="px-3 py-2 text-muted-foreground">{label}</td>
      <td className="px-3 py-2 text-right">{g?.delta?.toFixed(3) ?? "—"}</td>
      <td className="px-3 py-2 text-right">{g?.gamma?.toFixed(4) ?? "—"}</td>
      <td className="px-3 py-2 text-right">{g?.charm?.toFixed(5) ?? "—"}</td>
    </tr>
  );
  return (
    <SectionCard icon={<ActivityIcon className="w-4 h-4" />} title="OPTIONS GREEKS (ATM)">
      <div className="flex flex-wrap gap-4 mb-4">
        <div className="text-xs font-mono text-muted-foreground">
          SPOT: <span className="text-foreground font-bold">{greeks.spot != null ? fmtCurrency(greeks.spot) : "—"}</span>
        </div>
        <div className="text-xs font-mono text-muted-foreground">
          STRIKE: <span className="text-foreground font-bold">{greeks.strike != null ? fmtCurrency(greeks.strike) : "—"}</span>
        </div>
        <div className="text-xs font-mono text-muted-foreground">
          EXPIRY: <span className="text-foreground font-bold">{greeks.expiration ?? "—"}</span>
        </div>
      </div>
      <div className="bg-secondary rounded-lg overflow-hidden overflow-x-auto">
        <table className="w-full font-mono text-xs">
          <thead className="bg-secondary/70 text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-normal text-left">SIDE</th>
              <th className="px-3 py-2 font-normal text-right">DELTA</th>
              <th className="px-3 py-2 font-normal text-right">GAMMA</th>
              <th className="px-3 py-2 font-normal text-right">CHARM</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {row("CALL", greeks.call)}
            {row("PUT", greeks.put)}
          </tbody>
        </table>
      </div>
      <p className="text-xs font-mono text-muted-foreground leading-relaxed mt-4">{greeks.explanation}</p>
      {greeks.signalNote && (
        <p className="text-xs font-mono text-muted-foreground leading-relaxed mt-2">Signal: {greeks.signalNote}</p>
      )}
    </SectionCard>
  );
}

export function MacroContextSection({ items }: { items: AnalysisResult["macroContext"] }) {
  if (!items || items.length === 0) return null;
  return (
    <SectionCard icon={<Globe className="w-4 h-4" />} title="MACRO CONTEXT">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {items.map((m, i) => (
          <div key={i} className="bg-secondary rounded-lg p-3">
            <div className="text-[10px] font-mono text-muted-foreground mb-1">{m.label}</div>
            <div className="font-mono text-base font-bold">{m.value}</div>
            <StatusBadge status={m.status} />
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export function AiReportSection({ aiReport }: { aiReport: AnalysisResult["aiReport"] }) {
  const queryClient = useQueryClient();
  const [input, setInput] = React.useState("");
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const chatMutation = useAiChat();
  const { data: status } = useGetAiStatus({ query: { queryKey: getGetAiStatusQueryKey() } });

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    chatMutation.mutate(
      {
        data: {
          provider: "free",
          messages: [
            { role: "system", content: "You are a concise equity research assistant. Reference the ticker context from the analysis report when relevant. Always remind the user this is not financial advice." },
            ...next.map((m) => ({ role: m.role, content: m.content })),
          ],
        },
      },
      {
        onSuccess: (reply) => {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: reply.content ?? "No response." },
          ]);
          queryClient.invalidateQueries({ queryKey: getGetAiStatusQueryKey() });
        },
        onError: (err) => {
          const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: msg ?? "I could not reach the AI provider right now." },
          ]);
        },
      }
    );
  };

  return (
    <div className="bg-card border border-border rounded-xl p-6 space-y-4">
      <h2 className="font-mono text-sm font-bold tracking-widest text-muted-foreground border-b border-border pb-3 flex items-center gap-2">
        <Bot className="w-4 h-4" />
        AI RESEARCH ANALYST
      </h2>

      {aiReport?.available && aiReport.content ? (
        <div className="bg-secondary/50 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[10px] font-mono text-muted-foreground">
              MODEL: <span className="text-primary">{aiReport.model ?? "unknown"}</span> · {aiReport.provider}
            </div>
          </div>
          <div className="text-sm font-mono text-foreground leading-relaxed whitespace-pre-wrap">
            {aiReport.content}
          </div>
        </div>
      ) : (
        <div className="text-xs font-mono text-muted-foreground leading-relaxed">
          {aiReport?.note ?? "AI commentary unavailable."} Configure a GROQ_API_KEY to enable the full AI report.
        </div>
      )}

      {status && (
        <div className="text-[10px] font-mono text-muted-foreground flex items-center gap-2">
          <div className={cn("w-2 h-2 rounded-full", (status.remaining ?? 0) > 0 ? "bg-green-500" : "bg-destructive")} />
          FREE CHAT: {status.remaining}/{status.limit} REMAINING
        </div>
      )}

      <form onSubmit={handleSend} className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="ASK THE AI ANALYST ABOUT THIS STOCK..."
          className="flex-1 bg-secondary border border-border rounded-lg px-4 py-2.5 text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
        />
        <button
          type="submit"
          disabled={!input.trim() || chatMutation.isPending}
          className="bg-primary text-primary-foreground px-4 rounded-lg flex items-center gap-2 font-mono text-sm font-bold disabled:opacity-50 hover:bg-primary/90 transition-colors"
        >
          {chatMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          ASK
        </button>
      </form>

      {messages.length > 0 && (
        <div className="space-y-3 border-t border-border pt-4 max-h-72 overflow-y-auto">
          {messages.map((m, i) => (
            <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[85%] rounded-xl px-4 py-3 text-sm font-mono leading-relaxed",
                  m.role === "user"
                    ? "bg-primary/10 text-primary border border-primary/20"
                    : "bg-secondary text-foreground"
                )}
              >
                {m.content}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function DisclaimerSection({ disclaimer }: { disclaimer?: string }) {
  if (!disclaimer) return null;
  return (
    <div className="bg-secondary/50 border border-border rounded-xl px-6 py-4 text-xs font-mono text-muted-foreground text-center leading-relaxed">
      {disclaimer}
    </div>
  );
}