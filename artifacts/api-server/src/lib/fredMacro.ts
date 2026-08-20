import { logger } from "./logger";

const FRED_BASE = "https://api.stlouisfed.org/fred/series/observations";

interface FredObservation {
  date: string;
  value: string;
}
interface FredResponse {
  observations: FredObservation[];
}

export async function fetchFredSeries(seriesId: string, limit = 15): Promise<FredObservation[]> {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) {
    logger.warn({ seriesId }, "FRED_API_KEY not set, skipping FRED fetch");
    return [];
  }
  const url = `${FRED_BASE}?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) {
    logger.warn({ seriesId, status: res.status }, "FRED API request failed");
    return [];
  }
  const data = (await res.json()) as FredResponse;
  return data.observations.filter((o) => o.value !== ".");
}

export function latestValue(obs: FredObservation[]): number | null {
  const first = obs[0];
  if (!first) return null;
  const v = parseFloat(first.value);
  return isNaN(v) ? null : v;
}

export interface MacroEntry {
  label: string;
  value: string;
  status: string | null;
}

export async function fetchMacroData(): Promise<MacroEntry[]> {
  const [gdp, realGDP, cpiObs, unemployment, fedFunds] = await Promise.allSettled([
    fetchFredSeries("GDP", 2),
    fetchFredSeries("GDPC1", 2),
    fetchFredSeries("CPIAUCSL", 15),
    fetchFredSeries("UNRATE", 2),
    fetchFredSeries("FEDFUNDS", 2),
  ]);

  const entries: MacroEntry[] = [];

  // GDP
  if (gdp.status === "fulfilled") {
    const v = latestValue(gdp.value);
    entries.push({
      label: "GDP (Nominal)",
      value: v != null ? `$${(v / 1000).toFixed(2)}T` : "N/A",
      status: null,
    });
  }

  // Real GDP
  if (realGDP.status === "fulfilled") {
    const v = latestValue(realGDP.value);
    entries.push({
      label: "Real GDP",
      value: v != null ? `$${(v / 1000).toFixed(2)}T` : "N/A",
      status: null,
    });
  }

  // CPI & inflation
  if (cpiObs.status === "fulfilled" && cpiObs.value.length >= 13) {
    const latest = latestValue(cpiObs.value);
    const yearAgo = latestValue(cpiObs.value.slice(12));
    entries.push({
      label: "CPI",
      value: latest != null ? latest.toFixed(2) : "N/A",
      status: null,
    });
    if (latest != null && yearAgo != null && yearAgo !== 0) {
      const inflation = ((latest - yearAgo) / yearAgo) * 100;
      let status: string | null = null;
      if (inflation > 4) status = "bearish";
      else if (inflation > 2) status = "neutral";
      else status = "bullish";
      entries.push({
        label: "Inflation YoY",
        value: `${inflation.toFixed(2)}%`,
        status,
      });
    }
  }

  // Unemployment
  if (unemployment.status === "fulfilled") {
    const v = latestValue(unemployment.value);
    let status: string | null = null;
    if (v != null) {
      if (v < 4) status = "bullish";
      else if (v < 6) status = "neutral";
      else status = "bearish";
    }
    entries.push({
      label: "Unemployment Rate",
      value: v != null ? `${v.toFixed(2)}%` : "N/A",
      status,
    });
  }

  // Fed Funds
  if (fedFunds.status === "fulfilled") {
    const v = latestValue(fedFunds.value);
    let status: string | null = null;
    if (v != null) {
      if (v < 3) status = "bullish";
      else if (v < 5) status = "neutral";
      else status = "bearish";
    }
    entries.push({
      label: "Fed Funds Rate",
      value: v != null ? `${v.toFixed(2)}%` : "N/A",
      status,
    });
  }

  return entries;
}
