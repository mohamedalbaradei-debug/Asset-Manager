import { logger } from "./logger";
import { secTickerMap } from "./stockDetail";

/**
 * Insider trading feed from SEC EDGAR Form 4 filings. Uses the submissions
 * API for the filing list and parses each filing's primary XML document.
 * Keyless; requires a descriptive User-Agent (SEC fair-access policy).
 */

export interface InsiderTrade {
  date: string | null;
  filedAt: string;
  insider: string;
  role: string | null;
  action: "buy" | "sell" | "option" | "gift" | "award" | "other";
  code: string;
  shares: number | null;
  price: number | null;
  valueUsd: number | null;
  afterOwnship: number | null;
}

export interface InsidersData {
  symbol: string;
  issuer: string | null;
  trades: InsiderTrade[];
  netBuyValueUsd: number | null;
  updatedAt: string;
}

interface SubmissionsShape {
  filings?: {
    recent?: {
      form?: string[];
      filingDate?: string[];
      accessionNumber?: string[];
      primaryDocument?: string[];
    };
  };
}

const SEC_HEADERS = {
  "User-Agent": "Asset-Manager personal-investment-dashboard admin@asset-manager.local",
  Accept: "application/json,text/xml",
};

function tag(xml: string, name: string): string | null {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? m[1].trim() : null;
}

function numOrNull(s: string | null): number | null {
  if (s == null) return null;
  const v = parseFloat(s.replace(/,/g, ""));
  return isFinite(v) ? v : null;
}

const ACTION_BY_CODE: Record<string, InsiderTrade["action"]> = {
  P: "buy",
  S: "sell",
  M: "option",
  G: "gift",
  A: "award",
};

function parseForm4(xml: string): { trades: Array<Omit<InsiderTrade, "filedAt">>; issuer: string | null } {
  const issuer = tag(xml, "issuerName");
  const insider =
    tag(xml, "rptOwnerName") ??
    (() => {
      const owners = xml.split(/<reportingOwner>/).slice(1);
      const names = owners.map((o) => tag(o, "rptOwnerName")).filter((n): n is string => !!n);
      return names.join(", ") || null;
    })();
  const isDirector = tag(xml, "isDirector");
  const isOfficer = tag(xml, "isOfficer");
  const isTenPct = tag(xml, "isTenPercentOwner");
  const title = tag(xml, "officerTitle");
  const roles: string[] = [];
  if (isDirector === "1") roles.push("Director");
  if (isTenPct === "1") roles.push("10% Owner");
  if (isOfficer === "1" && title) roles.push(title);
  const role = roles.length > 0 ? roles.join(", ") : title ?? null;

  const body = xml.split("<nonDerivativeTable>")[1]?.split("</nonDerivativeTable>")[0] ?? "";
  const txns = body.split("<nonDerivativeTransaction>").slice(1);
  const trades = txns.map((t) => {
    const code = (tag(t, "transactionCode") ?? "").toUpperCase();
    return {
      date: tag(t.split("<transactionDate>")[1] ?? "", "value"),
      insider: insider ?? "Unknown",
      role,
      action: ACTION_BY_CODE[code] ?? "other",
      code,
      shares: numOrNull(tag(t.split("<transactionShares>")[1] ?? "", "value")),
      price: numOrNull(tag(t.split("<transactionPricePerShare>")[1] ?? "", "value")),
      valueUsd: null as number | null,
      afterOwnship: numOrNull(tag(t.split("<postTransactionAmounts>")[1] ?? "", "sharesOwnedFollowingTransaction")),
    };
  });
  for (const tr of trades) {
    if (tr.shares != null && tr.price != null) tr.valueUsd = Math.round(tr.shares * tr.price);
  }
  return { trades, issuer: issuer ?? null };
}

const insidersCache = new Map<string, { t: number; v: InsidersData | null }>();

export async function getInsiders(symbolRaw: string): Promise<InsidersData | null> {
  const symbol = symbolRaw.toUpperCase().trim();
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) return null;

  const hit = insidersCache.get(symbol);
  if (hit && Date.now() - hit.t < 6 * 3600_000) return hit.v;

  try {
    const map = await secTickerMap();
    const entry = map.get(symbol);
    if (!entry) throw new Error(`No CIK for ${symbol}`);
    const cik10 = String(entry.cik).padStart(10, "0");

    const subRes = await fetch(`https://data.sec.gov/submissions/CIK${cik10}.json`, {
      headers: SEC_HEADERS,
      signal: AbortSignal.timeout(20000),
    });
    if (!subRes.ok) throw new Error(`submissions ${subRes.status}`);
    const sub = (await subRes.json()) as SubmissionsShape;
    const r = sub.filings?.recent;
    if (!r?.form) throw new Error("submissions empty");

    // Latest 8 Form 4 filings.
    const picks: Array<{ acc: string; date: string }> = [];
    for (let i = 0; i < r.form.length && picks.length < 8; i++) {
      if (r.form[i] !== "4") continue;
      const acc = r.accessionNumber?.[i];
      if (!acc) continue;
      picks.push({ acc, date: r.filingDate?.[i] ?? "" });
    }

    const results = await Promise.allSettled(
      picks.map(async ({ acc, date }) => {
        const accNoDash = acc.replace(/-/g, "");
        const indexRes = await fetch(
          `https://www.sec.gov/Archives/edgar/data/${entry.cik}/${accNoDash}/index.json`,
          { headers: SEC_HEADERS, signal: AbortSignal.timeout(15000) },
        );
        let docName: string | null = null;
        if (indexRes.ok) {
          const idx = (await indexRes.json()) as { directory?: { item?: Array<{ name?: string }> } };
          docName =
            idx.directory?.item?.map((x) => x.name ?? "").find((n) => /^form4.*\.xml$/i.test(n) || (/\.xml$/i.test(n) && !/primary|index/i.test(n))) ?? null;
        }
        if (!docName) docName = `form4.xml`;
        const xmlRes = await fetch(
          `https://www.sec.gov/Archives/edgar/data/${entry.cik}/${accNoDash}/${docName}`,
          { headers: SEC_HEADERS, signal: AbortSignal.timeout(15000) },
        );
        if (!xmlRes.ok) throw new Error(`form4 ${xmlRes.status}`);
        const xml = await xmlRes.text();
        const parsed = parseForm4(xml);
        return { parsed, date, acc };
      }),
    );

    const issuerNames: string[] = [];
    const trades: InsiderTrade[] = [];
    for (let i = 0; i < results.length; i++) {
      const res = results[i];
      if (res.status !== "fulfilled") continue;
      if (res.value.parsed.issuer) issuerNames.push(res.value.parsed.issuer);
      for (const t of res.value.parsed.trades) trades.push({ ...t, filedAt: res.value.date });
    }

    let netBuy = 0;
    let sawValue = false;
    for (const t of trades) {
      if (t.valueUsd == null) continue;
      sawValue = true;
      if (t.action === "buy") netBuy += t.valueUsd;
      else if (t.action === "sell") netBuy -= t.valueUsd;
    }

    const out: InsidersData = {
      symbol,
      issuer: issuerNames[0] ?? entry.title,
      trades: trades.slice(0, 20),
      netBuyValueUsd: sawValue ? Math.round(netBuy) : null,
      updatedAt: new Date().toISOString(),
    };
    insidersCache.set(symbol, { t: Date.now(), v: out });
    return out;
  } catch (err) {
    logger.warn({ err, symbol }, "Insider fetch failed");
    insidersCache.set(symbol, { t: Date.now(), v: null });
    return null;
  }
}
