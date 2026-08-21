import React from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

export interface OhlcPoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

const UP = "#22c55e";
const DOWN = "#ef4444";

/**
 * Daily candlestick chart built from stacked transparent/colored bars:
 * [0 → min(o,c)] transparent · [min(o,c) → max(o,c)] body · [max(o,c) → high]
 * transparent. The lower wick (low → min) renders inside the body shape.
 */
export function CandleChart({
  ohlc,
  support,
  resistance,
}: {
  ohlc: OhlcPoint[];
  support?: number | null;
  resistance?: number | null;
}) {
  const clean = React.useMemo(
    () => (ohlc ?? []).filter((d) => d.open != null && d.high != null && d.low != null && d.close != null),
    [ohlc]
  );

  const chartData = React.useMemo(() => {
    if (clean.length === 0) return [];
    let minLow = Infinity;
    let maxHigh = -Infinity;
    for (const d of clean) {
      if (d.low < minLow) minLow = d.low;
      if (d.high > maxHigh) maxHigh = d.high;
    }
    const eps = (maxHigh - minLow) * 0.0008 || 0.01;
    return clean.map((d) => ({
      ...d,
      up: d.close >= d.open,
      segLow: Math.min(d.open, d.close),
      segBody: Math.max(Math.abs(d.close - d.open), eps),
      segWickTop: d.high - Math.max(d.open, d.close),
    }));
  }, [clean]);

  if (chartData.length === 0) return null;

  const domainMin = Math.min(...chartData.map((d) => d.low));
  const domainMax = Math.max(...chartData.map((d) => d.high));
  const pad = (domainMax - domainMin) * 0.04 || 1;

  const tooltipStyle = {
    backgroundColor: "hsl(var(--card))",
    border: "1px solid hsl(var(--border))",
    borderRadius: "8px",
  };

  return (
    <div className="bg-card border border-border rounded-xl p-6">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
        <h2 className="font-mono text-sm font-bold tracking-widest text-muted-foreground">
          PRICE CHART (1Y)
        </h2>
        <div className="flex items-center gap-4 text-xs font-mono">
          {support != null && (
            <div className="flex items-center gap-2">
              <div className="w-3 h-0.5" style={{ backgroundColor: UP }} />
              <span>Support {support.toFixed(2)}</span>
            </div>
          )}
          {resistance != null && (
            <div className="flex items-center gap-2">
              <div className="w-3 h-0.5" style={{ backgroundColor: DOWN }} />
              <span>Resistance {resistance.toFixed(2)}</span>
            </div>
          )}
        </div>
      </div>
      <div className="h-[320px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 5, right: 0, left: -20, bottom: 0 }} barCategoryGap="12%">
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis
              dataKey="date"
              stroke="hsl(var(--muted-foreground))"
              fontSize={10}
              tickLine={false}
              axisLine={false}
              minTickGap={40}
              tickFormatter={(val) => {
                const d = new Date(val);
                return `${d.getMonth() + 1}/${d.getFullYear().toString().slice(2)}`;
              }}
            />
            <YAxis
              stroke="hsl(var(--muted-foreground))"
              fontSize={10}
              tickLine={false}
              axisLine={false}
              domain={[domainMin - pad, domainMax + pad]}
              tickFormatter={(val) => `${val.toFixed(0)}`}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              itemStyle={{ fontFamily: "var(--font-mono)", fontSize: "12px" }}
              labelStyle={{
                fontFamily: "var(--font-mono)",
                fontSize: "10px",
                color: "hsl(var(--muted-foreground))",
                marginBottom: "4px",
              }}
              cursor={{ fill: "hsl(var(--muted))", opacity: 0.3 }}
              formatter={(value: number, name: string) => [value.toFixed(2), name]}
              labelFormatter={(label) => {
                const d = chartData.find((c) => c.date === label);
                if (!d) return label;
                return `${label} · O ${d.open.toFixed(2)} H ${d.high.toFixed(2)} L ${d.low.toFixed(2)} C ${d.close.toFixed(2)}`;
              }}
            />
            {support != null && (
              <ReferenceLine
                y={support}
                stroke={UP}
                strokeDasharray="6 4"
                strokeWidth={1.5}
                label={{
                  value: `S ${support.toFixed(2)}`,
                  position: "insideBottomLeft",
                  fill: UP,
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                }}
              />
            )}
            {resistance != null && (
              <ReferenceLine
                y={resistance}
                stroke={DOWN}
                strokeDasharray="6 4"
                strokeWidth={1.5}
                label={{
                  value: `R ${resistance.toFixed(2)}`,
                  position: "insideTopLeft",
                  fill: DOWN,
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                }}
              />
            )}
            {/* Lower wick + lower half of body */}
            <Bar dataKey="segLow" stackId="c" fill="transparent" isAnimationActive={false} />
            {/* Body — custom shape draws the full candle including both wicks */}
            <Bar dataKey="segBody" stackId="c" isAnimationActive={false} shape={(props: any): React.ReactElement => {
              const { x, y, width, height, payload } = props;
              if (!payload || x == null || y == null) return <g />;
              const { open, close, high, low, segBody } = payload;
              if ([open, close, high, low, segBody].some((v: number | null) => v == null)) return <g />;
              const up = close >= open;
              const color = up ? UP : DOWN;
              const bodyH = Math.max(1, height);
              const pxPerUnit = bodyH / Math.max(segBody, 1e-9);
              const cx = x + width / 2;
              const wickAbovePx = (high - Math.max(open, close)) * pxPerUnit;
              const wickBelowPx = (Math.min(open, close) - low) * pxPerUnit;
              const bodyW = Math.max(1.5, Math.min(width * 0.72, 18));
              return (
                <g>
                  <line
                    x1={cx}
                    x2={cx}
                    y1={y - wickAbovePx}
                    y2={y + bodyH + wickBelowPx}
                    stroke={color}
                    strokeWidth={1.2}
                  />
                  <rect x={cx - bodyW / 2} y={y} width={bodyW} height={bodyH} fill={color} />
                </g>
              );
            }} />
            {/* Upper wick */}
            <Bar dataKey="segWickTop" stackId="c" fill="transparent" isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
