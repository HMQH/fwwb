"use client"

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts"

type RiskPoint = {
  label: string
  value: number
}

const COLORS = ["var(--color-destructive)", "var(--color-chart-2)", "var(--color-chart-4)"]

export function RiskDistributionChart({ data }: { data: RiskPoint[] }) {
  const total = data.reduce((sum, item) => sum + item.value, 0)

  return (
    <div className="flex flex-col sm:flex-row items-center gap-6">
      <div className="relative h-44 w-44 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              innerRadius={54}
              outerRadius={80}
              dataKey="value"
              stroke="var(--color-card)"
              strokeWidth={3}
            >
              {data.map((entry, index) => (
                <Cell key={entry.label} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: "var(--color-popover)",
                border: "1px solid var(--color-border)",
                borderRadius: 8,
                fontSize: 12,
                color: "var(--color-foreground)",
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <p className="text-xs text-muted-foreground">总结果</p>
          <p className="text-xl font-semibold text-foreground">{total.toLocaleString()}</p>
        </div>
      </div>
      <ul className="flex-1 space-y-2 w-full">
        {data.map((item, index) => {
          const pct = total > 0 ? ((item.value / total) * 100).toFixed(1) : "0.0"
          return (
            <li key={item.label} className="flex items-center gap-3 text-sm">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: COLORS[index % COLORS.length] }} />
              <span className="text-foreground">{item.label}</span>
              <span className="ml-auto text-muted-foreground tabular-nums">
                {item.value.toLocaleString()} · {pct}%
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
