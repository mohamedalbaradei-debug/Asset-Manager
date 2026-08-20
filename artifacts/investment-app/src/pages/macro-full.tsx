import React from "react";
import {
  useGetFullUsMacro,
  getGetFullUsMacroQueryKey,
} from "@workspace/api-client-react";
import { SectionHeader, SectionTitle, LoadingState, ErrorState, DataTile } from "@/components/panels";

export default function MacroFullPage() {
  const { data, isPending, isError } = useGetFullUsMacro({
    query: { queryKey: getGetFullUsMacroQueryKey() },
  });

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <SectionHeader title="US_MACRO" updatedAt={data?.updatedAt} />
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
    </div>
  );
}