import React from "react";
import {
  useGetShippingData,
  getGetShippingDataQueryKey,
} from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { SectionHeader, SectionTitle, LoadingState, ErrorState, EmptyNote, fmtNum } from "@/components/panels";

export default function ShippingPage() {
  const { data, isPending, isError } = useGetShippingData({
    query: { queryKey: getGetShippingDataQueryKey() },
  });

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <SectionHeader title="SHIPPING_CHOKEPOINTS" updatedAt={data?.updatedAt} />
      {isPending && <LoadingState />}
      {isError && <ErrorState message="Could not load shipping data." />}
      {data && (
        <section>
          <SectionTitle>IMF PORTWATCH TRANSIT</SectionTitle>
          {data.rows.length === 0 && <EmptyNote text="No transit data available." />}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {data.rows.map((r) => (
              <div key={r.chokepoint} className="bg-card border border-border rounded-xl p-5 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono font-bold text-lg">{r.chokepoint}</span>
                  <span className={cn(
                    "px-2.5 py-1 rounded text-[10px] font-mono font-bold uppercase tracking-wider border",
                    r.status === "bullish" ? "border-green-500/30 text-green-500" :
                    r.status === "bearish" ? "border-destructive/30 text-destructive" :
                    "border-border text-muted-foreground"
                  )}>
                    {r.status}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-[10px] font-mono text-muted-foreground mb-1">VOLUME (MT)</div>
                    <div className="font-mono text-xl font-bold">
                      {r.volumeTonnes != null ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(r.volumeTonnes) : "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-mono text-muted-foreground mb-1">VESSELS</div>
                    <div className="font-mono text-xl font-bold">{r.vessels ?? "—"}</div>
                  </div>
                </div>
                <p className="text-[10px] font-mono text-muted-foreground leading-relaxed border-t border-border pt-3">{r.note}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}