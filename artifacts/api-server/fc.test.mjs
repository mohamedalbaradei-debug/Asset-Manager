import { fetchChain } from "/Users/derlocko/Projects/Asset-Manager/artifacts/api-server/src/lib/optionsAnalysis.ts";
const { spot, options } = await fetchChain("AAPL");
console.log("spot:", spot, "| num expirations:", options.length);
const now = Date.now(); const MS_DAY = 86400000;
for (const o of options.slice(0, 8)) {
  const d = (o.expirationDate.getTime() - now) / MS_DAY;
  console.log(o.expirationDate.toISOString().slice(0,10), "inDays:", d.toFixed(3), "| calls:", o.calls.length);
}
