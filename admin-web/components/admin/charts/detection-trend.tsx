"use client"

import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts"

type DetectionTrendPoint = Record<string, string | number>

export type DetectionTrendSeries = {
  key: string
  label: string
  color: string
  gradientId: string
}

const DEFAULT_SERIES: DetectionTrendSeries[] = [
  { key: "文本", label: "文本", color: "var(--color-primary)", gradientId: "admin-trend-text" },
  { key: "音频", label: "音频", color: "var(--color-chart-2)", gradientId: "admin-trend-audio" },
  { key: "图片", label: "图片", color: "var(--color-chart-4)", gradientId: "admin-trend-image" },
  { key: "视频", label: "视频", color: "var(--color-chart-5)", gradientId: "admin-trend-video" },
]

export function DetectionTrendChart({
  data,
  series = DEFAULT_SERIES,
}: {
  data: DetectionTrendPoint[]
  series?: DetectionTrendSeries[]
}) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 12, left: -10, bottom: 0 }}>
          <defs>
            {series.map((item) => (
              <linearGradient key={item.gradientId} id={item.gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={item.color} stopOpacity={0.42} />
                <stop offset="100%" stopColor={item.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
          <XAxis
            dataKey="day"
            tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: "var(--color-border)" }}
          />
          <YAxis
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
          {series.map((item) => (
            <Area
              key={item.key}
              type="monotone"
              dataKey={item.key}
              name={item.label}
              stroke={item.color}
              strokeWidth={2}
              fill={`url(#${item.gradientId})`}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
