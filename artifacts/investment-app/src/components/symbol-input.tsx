import React from "react";
import { Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

/** Debounced Yahoo symbol search → { options, listId } for any <input list=…>. */
export function useSymbolSuggestions(query: string) {
  const [debounced, setDebounced] = React.useState("");
  React.useEffect(() => {
    const t = setTimeout(() => {
      const v = query.trim();
      setDebounced(v.length >= 2 ? v : "");
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const { data } = useQuery({
    queryKey: ["symbol-search", debounced],
    queryFn: async () => {
      const res = await fetch(`/api/search?q=${encodeURIComponent(debounced)}`);
      if (!res.ok) return { results: [] };
      return res.json() as Promise<{
        results: Array<{ symbol: string; name: string | null }>;
      }>;
    },
    enabled: debounced.length >= 2,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const listId = React.useId();
  const options = data?.results ?? [];
  return { options, listId };
}

/**
 * Ticker input with live Yahoo symbol-search autocomplete (datalist based,
 * so it stays a plain form field). Works for stocks, ETFs, futures, FX,
 * crypto and indices on any exchange.
 */
export function SymbolInput({
  value,
  onChange,
  placeholder = "TICKER or company name",
  className,
  required = false,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  required?: boolean;
}) {
  const { options, listId } = useSymbolSuggestions(value);

  return (
    <div className="relative">
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
      <input
        value={value}
        required={required}
        list={listId}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        className={`${className ?? ""} pl-8 bg-secondary border border-border rounded-md px-2.5 py-2 text-sm font-mono uppercase placeholder:text-muted-foreground placeholder:normal-case focus:outline-none focus:border-primary`}
        aria-label="Symbol"
      />
      <datalist id={listId}>
        {options.slice(0, 8).map((o) => (
          <option key={o.symbol} value={o.symbol}>
            {o.name ?? o.symbol}
          </option>
        ))}
      </datalist>
    </div>
  );
}
