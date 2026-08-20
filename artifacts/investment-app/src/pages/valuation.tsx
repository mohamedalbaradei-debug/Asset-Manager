import React from "react";
import {
  useGetValuationData,
  getGetValuationDataQueryKey,
} from "@workspace/api-client-react";
import { SectionHeader, SectionTitle, LoadingState, ErrorState, DataTile, EmptyNote, fmtNum } from "@/components/panels";

export default function ValuationPage() {
  const { data, isPending, isError } = useGetValuationData({
    query: { queryKey: getGetValuationDataQueryKey() },
  });

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <SectionHeader title="S&amp;P_VALUATION" updatedAt={data?.updatedAt} />
      {isPending && <LoadingState />}
      {isError && <ErrorState message="Could not load valuation data." />}
      {data && (
        <section>
          <SectionTitle>INDEX VALUATION METRICS</SectionTitle>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <DataTile label="P/E RATIO" value={data.pe != null ? fmtNum(data.pe) : "—"} />
            <DataTile label="CAPE / SHILLER" value={data.cape != null ? fmtNum(data.cape) : "—"} />
            <DataTile label="EARNINGS YIELD" value={data.earningsYield != null ? `${fmtNum(data.earningsYield)}%` : "—"} />
            <DataTile label="DIVIDEND YIELD" value={data.dividendYield != null ? `${fmtNum(data.dividendYield)}%` : "—"} />
          </div>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <DataTile label="SOURCE" value={data.source} />
            <DataTile label="NOTE" value={data.note ?? "—"} />
          </div>
          {data.note && <div className="mt-4"><EmptyNote text={data.note} /></div>}
        </section>
      )}
    </div>
  );
}