import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, TrendingUp, Gift, Split, Rocket } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type CalType = "earnings" | "dividends" | "splits" | "ipo";

const TYPES: { key: CalType; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "earnings", label: "Earnings", icon: TrendingUp },
  { key: "dividends", label: "Dividends", icon: Gift },
  { key: "splits", label: "Splits", icon: Split },
  { key: "ipo", label: "IPOs", icon: Rocket },
];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

interface Row {
  symbol?: string | null;
  name?: string | null;
  // earnings
  fiscalQuarterEnding?: string | null;
  epsForecast?: string | null;
  lastYearEps?: string | null;
  time?: string | null;
  marketCap?: string | null;
  // dividends
  exDate?: string | null;
  paymentDate?: string | null;
  recordDate?: string | null;
  dividendRate?: number | null;
  annualDividend?: number | null;
  // splits
  ratio?: string | null;
  executionDate?: string | null;
  // ipo
  exchange?: string | null;
  price?: string | null;
  shares?: string | null;
  expectedDate?: string | null;
  status?: string | null;
}

function Headers({ type }: { type: CalType }) {
  if (type === "earnings")
    return (
      <>
        <TableHead>Symbol</TableHead>
        <TableHead>Company</TableHead>
        <TableHead>Qtr Ending</TableHead>
        <TableHead className="text-right">EPS Est</TableHead>
        <TableHead className="text-right">EPS Last Yr</TableHead>
        <TableHead>Time</TableHead>
        <TableHead className="text-right">Mkt Cap</TableHead>
      </>
    );
  if (type === "dividends")
    return (
      <>
        <TableHead>Symbol</TableHead>
        <TableHead>Company</TableHead>
        <TableHead>Ex-Date</TableHead>
        <TableHead>Pay Date</TableHead>
        <TableHead>Record</TableHead>
        <TableHead className="text-right">Rate</TableHead>
        <TableHead className="text-right">Annual</TableHead>
      </>
    );
  if (type === "splits")
    return (
      <>
        <TableHead>Symbol</TableHead>
        <TableHead>Company</TableHead>
        <TableHead>Ratio</TableHead>
        <TableHead>Execution</TableHead>
      </>
    );
  return (
    <>
      <TableHead>Symbol</TableHead>
      <TableHead>Company</TableHead>
      <TableHead>Exchange</TableHead>
      <TableHead className="text-right">Price</TableHead>
      <TableHead className="text-right">Shares</TableHead>
      <TableHead>Expected</TableHead>
      <TableHead>Status</TableHead>
    </>
  );
}

function Cells({ type, r }: { type: CalType; r: Row }) {
  if (type === "earnings")
    return (
      <>
        <TableCell className="font-semibold">{r.symbol}</TableCell>
        <TableCell className="max-w-[220px] truncate">{r.name}</TableCell>
        <TableCell>{r.fiscalQuarterEnding ?? "—"}</TableCell>
        <TableCell className="text-right">{r.epsForecast ?? "—"}</TableCell>
        <TableCell className="text-right">{r.lastYearEps ?? "—"}</TableCell>
        <TableCell className="capitalize">{String(r.time ?? "").replace("time-", "") || "—"}</TableCell>
        <TableCell className="text-right">{r.marketCap ?? "—"}</TableCell>
      </>
    );
  if (type === "dividends")
    return (
      <>
        <TableCell className="font-semibold">{r.symbol}</TableCell>
        <TableCell className="max-w-[220px] truncate">{r.name}</TableCell>
        <TableCell>{r.exDate ?? "—"}</TableCell>
        <TableCell>{r.paymentDate ?? "—"}</TableCell>
        <TableCell>{r.recordDate ?? "—"}</TableCell>
        <TableCell className="text-right">{r.dividendRate ?? "—"}</TableCell>
        <TableCell className="text-right">{r.annualDividend ?? "—"}</TableCell>
      </>
    );
  if (type === "splits")
    return (
      <>
        <TableCell className="font-semibold">{r.symbol}</TableCell>
        <TableCell className="max-w-[260px] truncate">{r.name}</TableCell>
        <TableCell className="font-medium">{r.ratio ?? "—"}</TableCell>
        <TableCell>{r.executionDate ?? "—"}</TableCell>
      </>
    );
  return (
    <>
      <TableCell className="font-semibold">{r.symbol ?? "—"}</TableCell>
      <TableCell className="max-w-[240px] truncate">{r.name}</TableCell>
      <TableCell>{r.exchange ?? "—"}</TableCell>
      <TableCell className="text-right">{r.price ?? "—"}</TableCell>
      <TableCell className="text-right">{r.shares ?? "—"}</TableCell>
      <TableCell>{r.expectedDate ?? "—"}</TableCell>
      <TableCell>
        <Badge variant={r.status === "priced" ? "default" : "secondary"}>{r.status}</Badge>
      </TableCell>
    </>
  );
}

export function CalendarPage() {
  const [type, setType] = useState<CalType>("earnings");
  const [date, setDate] = useState<string>(today());

  const { data, isPending, isError } = useQuery({
    queryKey: ["market-calendar", type, date],
    queryFn: async () => {
      const res = await fetch(`/api/market-calendar?type=${type}&date=${date}`);
      if (!res.ok) throw new Error("Failed to load calendar");
      return (await res.json()) as { type: CalType; asOf: string; rows: Row[] };
    },
  });

  const rows = data?.rows ?? [];

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-6xl mx-auto">
      <div className="flex items-center gap-2">
        <CalendarDays className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Market Calendar</h1>
          <p className="text-sm text-muted-foreground">
            Earnings, dividends, splits &amp; IPOs — sourced from Nasdaq's free public calendar.
          </p>
        </div>
      </div>

      <div className="flex flex-col md:flex-row md:items-center gap-3 flex-wrap">
        <div className="flex gap-1.5 flex-wrap">
          {TYPES.map((t) => {
            const Icon = t.icon;
            return (
              <Button
                key={t.key}
                size="sm"
                variant={type === t.key ? "default" : "outline"}
                onClick={() => setType(t.key)}
                className="gap-1.5"
              >
                <Icon className="h-4 w-4" />
                {t.label}
              </Button>
            );
          })}
        </div>
        <div className="md:ml-auto flex items-center gap-2">
          <label className="text-sm text-muted-foreground">Date</label>
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-auto"
          />
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="capitalize text-lg">
            {TYPES.find((t) => t.key === type)?.label} — {date}
          </CardTitle>
          <CardDescription>
            {type === "ipo"
              ? "Current month's IPO calendar (priced, upcoming & filed)."
              : `Events scheduled for ${date}.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isPending ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>
          ) : isError ? (
            <p className="text-sm text-destructive py-8 text-center">
              Could not load calendar data. Try another date.
            </p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No {type} scheduled for this date.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <Headers type={type} />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r, i) => (
                    <TableRow key={`${r.symbol ?? i}-${i}`}>
                      <Cells type={type} r={r} />
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
