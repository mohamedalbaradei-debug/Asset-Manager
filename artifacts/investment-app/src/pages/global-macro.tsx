import React from "react";
import {
  useGetGlobalMacro,
  getGetGlobalMacroQueryKey,
} from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { SectionHeader, SectionTitle, LoadingState, ErrorState, fmtNum, EmptyNote } from "@/components/panels";

export default function GlobalMacroPage() {
  const { data, isPending, isError } = useGetGlobalMacro({
    query: { queryKey: getGetGlobalMacroQueryKey() },
  });

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <SectionHeader title="GLOBAL_MACRO" updatedAt={data?.updatedAt} />
      {isPending && <LoadingState />}
      {isError && <ErrorState message="Could not load global macro data." />}
      {data && (
        <>
          <section>
            <SectionTitle>CROSS-COUNTRY INFLATION &amp; RATES</SectionTitle>
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono text-sm whitespace-nowrap">
                  <thead className="bg-secondary/50 text-muted-foreground text-xs">
                    <tr>
                      <th className="px-5 py-4 font-normal">COUNTRY</th>
                      <th className="px-5 py-4 font-normal">CODE</th>
                      <th className="px-5 py-4 font-normal text-right">CPI YoY %</th>
                      <th className="px-5 py-4 font-normal text-right">SHORT RATE %</th>
                      <th className="px-5 py-4 font-normal text-right">REAL RATE %</th>
                      <th className="px-5 py-4 font-normal text-right">CLI</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.rows.map((r) => {
                      const realRate =
                        r.shortRate != null && r.cpiYoY != null ? r.shortRate - r.cpiYoY : null;
                      return (
                        <tr key={r.code} className="hover:bg-secondary/30 transition-colors">
                          <td className="px-5 py-3.5 font-bold">{r.country}</td>
                          <td className="px-5 py-3.5 text-muted-foreground">{r.code}</td>
                          <td className="px-5 py-3.5 text-right">{r.cpiYoY != null ? `${fmtNum(r.cpiYoY, 2)}%` : "—"}</td>
                          <td className="px-5 py-3.5 text-right">{r.shortRate != null ? `${fmtNum(r.shortRate, 2)}%` : "—"}</td>
                          <td className={cn("px-5 py-3.5 text-right font-bold", realRate != null && realRate >= 0 ? "text-green-500" : "text-destructive")}>
                            {realRate != null ? `${fmtNum(realRate, 2)}%` : "—"}
                          </td>
                          <td className="px-5 py-3.5 text-right text-muted-foreground">{r.cli ?? "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            <p className="text-[10px] font-mono text-muted-foreground mt-3">
              Real rate = short rate − CPI YoY. Positive real rates typically support currency strength.
            </p>
          </section>
          {data.note && <EmptyNote text={data.note} />}
        </>
      )}
    </div>
  );
}