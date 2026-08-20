import React from "react";
import {
  useGetFxData,
  getGetFxDataQueryKey,
} from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { SectionHeader, SectionTitle, LoadingState, ErrorState, fmtNum, fmtPct } from "@/components/panels";

export default function FxPage() {
  const { data, isPending, isError } = useGetFxData({
    query: { queryKey: getGetFxDataQueryKey() },
  });

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <SectionHeader title="FX_MONITOR" updatedAt={data?.updatedAt} />
      {isPending && <LoadingState />}
      {isError && <ErrorState message="Could not load FX data." />}
      {data && (
        <section>
          <SectionTitle>MAJOR PAIRS &amp; RATE DIFFERENTIALS</SectionTitle>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {data.rows.map((r) => {
              const diff = r.rateDifferentialPct;
              return (
                <div key={r.pair} className="bg-card border border-border rounded-xl p-5 flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold">{r.pair}</span>
                    <span className={cn(
                      "px-2 py-0.5 rounded text-[10px] font-mono font-bold border",
                      diff != null && diff >= 0 ? "border-green-500/30 text-green-500" : "border-destructive/30 text-destructive"
                    )}>
                      {fmtPct(diff)} carry
                    </span>
                  </div>
                  <div className="font-mono text-2xl font-bold">
                    {r.spot != null ? fmtNum(r.spot, 4) : "—"}
                  </div>
                  <p className="text-[10px] font-mono text-muted-foreground leading-relaxed border-t border-border pt-3">
                    {r.interpretation}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}