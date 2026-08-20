import React from "react";
import {
  useGetFedData,
  getGetFedDataQueryKey,
} from "@workspace/api-client-react";
import { ExternalLink } from "lucide-react";
import { SectionHeader, SectionTitle, LoadingState, ErrorState, DataTile, EmptyNote, fmtNum } from "@/components/panels";

export default function FedPage() {
  const { data, isPending, isError } = useGetFedData({
    query: { queryKey: getGetFedDataQueryKey() },
  });

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <SectionHeader title="FED_DASHBOARD" updatedAt={data?.updatedAt} />
      {isPending && <LoadingState />}
      {isError && <ErrorState message="Could not load Fed data." />}
      {data && (
        <>
          <section>
            <SectionTitle>FED BALANCE SHEET</SectionTitle>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {data.balanceSheet.map((item, i) => (
                <DataTile key={i} label={item.label} value={item.value} status={item.status} />
              ))}
            </div>
          </section>

          <section>
            <SectionTitle>PRIMARY DEALER TREASURY HOLDINGS</SectionTitle>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <DataTile
                label="Net Holdings (NYSE FED survey)"
                value={data.primaryDealerTreasuries.value != null ? `$${fmtNum(data.primaryDealerTreasuries.value)}B` : "—"}
                hint={data.primaryDealerTreasuries.note}
              />
            </div>
          </section>

          <section>
            <SectionTitle>FOMC DOCUMENTS</SectionTitle>
            {data.fomc.length === 0 ? (
              <EmptyNote text="No FOMC documents available." />
            ) : (
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <ul className="divide-y divide-border">
                  {data.fomc.map((doc, i) => (
                    <li key={i}>
                      <a
                        href={doc.link}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-secondary/30 transition-colors group"
                      >
                        <span className="font-mono text-sm group-hover:text-primary transition-colors">{doc.title}</span>
                        <ExternalLink className="w-4 h-4 text-muted-foreground shrink-0" />
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}