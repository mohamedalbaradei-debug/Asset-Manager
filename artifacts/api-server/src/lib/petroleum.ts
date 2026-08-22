import { logger } from "./logger";

/**
 * EIA Weekly Petroleum Status Report — keyless scrape of ir.eia.gov/wpsr/
 * table1.csv (published weekly). Stocks in million barrels with WoW/YoY
 * deltas; also captures US crude production from the supply section.
 */

export interface StockSeries {
  label: string;
  latest: number | null;
  prevWeek: number | null;
  yearAgo: number | null;
  changeWow: number | null;
  changeYoy: number | null;
}

export interface PetroleumData {
  available: boolean;
  note?: string;
  weekEnding?: string | null;
  prevWeekEnding?: string | null;
  stocks?: StockSeries[];
  domesticProductionKbd?: number | null;
  updatedAt: string;
}

interface CsvRow {
  cells: string[];
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      cur.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      cur.push(field);
      field = "";
      if (cur.some((x) => x.trim() !== "")) rows.push(cur);
      cur = [];
    } else field += c;
  }
  if (field !== "" || cur.length > 0) {
    cur.push(field);
    if (cur.some((x) => x.trim() !== "")) rows.push(cur);
  }
  return rows;
}

const num = (s: string | undefined): number | null => {
  if (!s) return null;
  const v = parseFloat(s.replace(/,/g, "").replace(/−/g, "-"));
  return isFinite(v) ? v : null;
};

/** M/D/YY (EIA style) → ISO yyyy-mm-dd */
function eiaDate(s: string | undefined): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec((s ?? "").trim());
  if (!m) return null;
  const year = 2000 + parseInt(m[3], 10);
  const d = new Date(Date.UTC(year, parseInt(m[1], 10) - 1, parseInt(m[2], 10)));
  return isNaN(d.getTime()) ? null : d.toISOString().split("T")[0];
}

const wpsrCache: { t: number; v: PetroleumData | null } = { t: 0, v: null };

const STOCK_ROWS: Array<[string, string]> = [
  ["", "Commercial (Excluding SPR)"],
  ["", "Strategic Petroleum Reserve (SPR)"],
  ["", "Total Motor Gasoline"],
  ["", "Kerosene-Type Jet Fuel"],
  ["", "Distillate Fuel Oil"],
  ["", "Residual Fuel Oil"],
  ["", "Propane/Propylene"],
  ["", "Other Oils"],
  ["", "Total Stocks (Excluding SPR)"],
  ["", "Total Stocks (Including SPR)"],
];

export async function getPetroleumStatus(): Promise<PetroleumData> {
  if (wpsrCache.v && Date.now() - wpsrCache.t < 6 * 3600_000) return wpsrCache.v;

  try {
    const res = await fetch("https://ir.eia.gov/wpsr/table1.csv", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Referer: "https://ir.eia.gov/wpsr/",
        Accept: "text/csv,*/*",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`WPSR csv ${res.status}`);
    const text = await res.text();
    const rows: CsvRow[] = parseCsv(text).map((cells) => ({ cells }));

    // Section 1: stocks table — header row starts with STUB_1 and holds dates.
    const headerIdx = rows.findIndex((r) => r.cells[0]?.trim() === "STUB_1");
    if (headerIdx < 0) throw new Error("WPSR csv missing header");
    const header = rows[headerIdx].cells;
    const weekEnding = eiaDate(header[1]);
    const prevWeekEnding = eiaDate(header[2]);
    const yearAgoDate = eiaDate(header[5]);

    // Rows between the stocks header and the next STUB_1 header form the
    // stocks list. Every label we track is globally unique in this table,
    // so index rows by their first cell (later duplicates win).
    const byFirst = new Map<string, CsvRow>();
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      if (r.cells[0]?.trim() === "STUB_1") break;
      const first = r.cells[0]?.trim() ?? "";
      if (!first) continue;
      byFirst.set(first, r);
    }

    const stocks: StockSeries[] = [];
    for (const [, label] of STOCK_ROWS) {
      const r = byFirst.get(label);
      if (!r) continue;
      stocks.push({
        label,
        latest: num(r.cells[1]),
        prevWeek: num(r.cells[2]),
        yearAgo: num(r.cells[5]) ?? (yearAgoDate ? null : null),
        changeWow: num(r.cells[3]),
        changeYoy: num(r.cells[6]),
      });
    }

    // Section 2: supply table — domestic production (thousand b/d), column 2.
    const supplyRow = rows.find((r) => r.cells.join("|").includes("Domestic Production"));
    const domesticProductionKbd = supplyRow ? num(supplyRow.cells[2]) : null;

    const out: PetroleumData = {
      available: stocks.length > 0,
      ...(stocks.length > 0
        ? { weekEnding, prevWeekEnding, stocks, domesticProductionKbd }
        : { note: "Weekly Petroleum Status Report table could not be parsed." }),
      updatedAt: new Date().toISOString(),
    };
    wpsrCache.t = Date.now();
    wpsrCache.v = out;
    return out;
  } catch (err) {
    logger.warn({ err }, "EIA WPSR fetch failed");
    const empty: PetroleumData = {
      available: false,
      note: "EIA Weekly Petroleum Status Report is temporarily unavailable.",
      updatedAt: new Date().toISOString(),
    };
    return empty;
  }
}
