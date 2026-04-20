"use client"

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

type RagTrendPoint = Record<string, string | number>

export function RagSyncTrendChart({ data }: { data: RagTrendPoint[] }) {
  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
          <XAxis
            dataKey="day"
            tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: "var(--color-border)" }}
          />
          <YAxis
            yAxisId="left"
            allowDecimals={false}
            tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            allowDecimals={false}
            tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            contentStyle={{
              background: "var(--color-popover)",
              border: "1px solid var(--color-border)",
              borderRadius: 8,
              fontSize: 12,
              color: "var(--color-foreground)",
            }}
          />
          <Legend />
          <Bar
            yAxisId="left"
            dataKey="向量化源数"
            name="向量化源数"
            barSize={22}
            radius={[6, 6, 0, 0]}
            fill="var(--color-primary)"
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="向量块数"
            name="向量块数"
            stroke="var(--color-chart-2)"
            strokeWidth={2.5}
            dot={{ r: 3, fill: "var(--color-chart-2)" }}
            activeDot={{ r: 5 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
