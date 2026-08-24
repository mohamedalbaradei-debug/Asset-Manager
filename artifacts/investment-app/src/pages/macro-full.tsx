import React from "react";
import {
  useGetFullUsMacro,
  getGetFullUsMacroQueryKey,
  useGetPetroleumStatus,
} from "@workspace/api-client-react";
import { SectionHeader, SectionTitle, LoadingState, ErrorState, DataTile } from "@/components/panels";
import { VixGauge } from "@/components/VixGauge";
import { cn } from "@/lib/utils";

const fmtMb = (v: number | null | undefined) =>
  v != null ? `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(v)}M bbl` : "—";

const fmtDelta = (v: number | null | undefined) => {
  if (v == null) return { text: "—", cls: "text-muted-foreground" };
  const arrow = v > 0 ? "▲" : v < 0 ? "▼" : "•";
  return {
    text: `${arrow} ${v > 0 ? "+" : ""}${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(v)}M`,
    cls: v > 0 ? "text-red-500" : v < 0 ? "text-green-500" : "text-muted-foreground",
  };
};

function PetroleumPanel() {
  const { data, isPending, isError } = useGetPetroleumStatus({
    query: { queryKey: ["getPetroleumStatus"] },
  });

  if (isPending) return null;
  if (isError || !data?.available) {
    return (
      <section>
        <SectionTitle>EIA OIL INVENTORIES</SectionTitle>
        <p className="text-[11px] font-mono text-muted-foreground">
          {data?.note ?? "Weekly petroleum status unavailable."}
        </p>
      </section>
    );
  }

  return (
    <section>
      <SectionTitle>
        EIA OIL INVENTORIES — WEEK ENDING {data.weekEnding ?? "?"}
      </SectionTitle>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {data.stocks?.map((s) => {
          const wow = fmtDelta(s.changeWow);
          return (
            <div key={s.label} className="bg-card border border-border rounded-xl p-4 flex flex-col gap-2">
              <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">{s.label}</div>
              <div className="font-mono text-lg font-bold">{fmtMb(s.latest)}</div>
              <div className={cn("font-mono text-[11px]", wow.cls)}>
                WoW {wow.text}
                {s.changeYoy != null && (
                  <span className="ml-2 text-muted-foreground">
                    YoY {s.changeYoy > 0 ? "+" : ""}
                    {new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(s.changeYoy)}M
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {data.domesticProductionKbd != null && (
        <p className="mt-3 text-[10px] font-mono text-muted-foreground">
          US crude production: {new Intl.NumberFormat("en-US").format(data.domesticProductionKbd)} thousand b/d · Source: EIA Weekly Petroleum Status Report
        </p>
      )}
    </section>
  );
}

export default function MacroFullPage() {
  const { data, isPending, isError } = useGetFullUsMacro({
    query: { queryKey: getGetFullUsMacroQueryKey() },
  });

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <SectionHeader title="US_MACRO" updatedAt={data?.updatedAt} />
      <VixGauge variant="panel" />
      {isPending && <LoadingState />}
      {isError && <ErrorState message="Could not load macro data." />}
      {data && (
        <section>
          <SectionTitle>US ECONOMIC INDICATORS</SectionTitle>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {data.items.map((item, i) => (
              <DataTile key={i} label={item.label} value={item.value} status={item.status} />
            ))}
          </div>
        </section>
      )}
      <PetroleumPanel />
    </div>
  );
}
