"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Database,
  RefreshCw,
  ShieldAlert,
  TrendingUp,
} from "lucide-react"
import { useAdminSession } from "@/components/admin/admin-session-provider"
import { DetectionTrendChart, type DetectionTrendSeries } from "@/components/admin/charts/detection-trend"
import { InterferenceTypesChart } from "@/components/admin/charts/interference-types"
import { RagStatusChart } from "@/components/admin/charts/rag-status"
import { RagSyncTrendChart } from "@/components/admin/charts/rag-sync-trend"
import { RiskDistributionChart } from "@/components/admin/charts/risk-distribution"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { fetchAdminAnalytics, fetchAdminDashboard, type AdminAnalyticsResponse, type AdminDashboardResponse } from "@/lib/admin-api"
import { formatFullDateTime } from "@/lib/admin-format"

const TREND_SERIES: DetectionTrendSeries[] = [
  { key: "文本", label: "文本", color: "var(--color-primary)", gradientId: "dashboard-text" },
  { key: "音频", label: "音频", color: "var(--color-chart-2)", gradientId: "dashboard-audio" },
  { key: "图片", label: "图片", color: "var(--color-chart-4)", gradientId: "dashboard-image" },
  { key: "视频", label: "视频", color: "var(--color-chart-5)", gradientId: "dashboard-video" },
]

type MetricTone = "primary" | "danger" | "warning" | "success"

function metricToneClass(tone: MetricTone) {
  if (tone === "danger") return "bg-destructive/15 text-destructive"
  if (tone === "warning") return "bg-chart-2/15 text-chart-2"
  if (tone === "success") return "bg-chart-4/15 text-chart-4"
  return "bg-primary/15 text-primary"
}

export default function DashboardPage() {
  const { accessToken } = useAdminSession()
  const [dashboard, setDashboard] = useState<AdminDashboardResponse | null>(null)
  const [analytics, setAnalytics] = useState<AdminAnalyticsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    if (!accessToken) return

    setLoading(true)
    setError(null)
    try {
      const [dashboardData, analyticsData] = await Promise.all([
        fetchAdminDashboard(accessToken),
        fetchAdminAnalytics(accessToken),
      ])
      setDashboard(dashboardData)
      setAnalytics(analyticsData)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "加载失败")
    } finally {
      setLoading(false)
    }
  }, [accessToken])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const metricCards = useMemo(() => {
    if (!dashboard || !analytics) return []

    return [
      {
        label: "累计检测",
        value: analytics.summary.submission_total,
        icon: Activity,
        tone: "primary" as const,
      },
      {
        label: "高风险结果",
        value: analytics.summary.high_risk_total,
        icon: ShieldAlert,
        tone: "danger" as const,
      },
      {
        label: "发布的案例数量",
        value: dashboard.stats.case_published ?? 0,
        icon: CheckCircle2,
        tone: "success" as const,
      },
      {
        label: "向量块数",
        value: analytics.summary.vector_chunk_total,
        icon: Database,
        tone: "warning" as const,
      },
      {
        label: "知识库资料",
        value: dashboard.stats.source_total ?? analytics.rag_overview.source_total,
        icon: BookOpen,
        tone: "primary" as const,
      },
    ]
  }, [analytics, dashboard])

  const hasDetectionTrend = useMemo(
    () =>
      Boolean(
        analytics?.detection_trend.some((item) =>
          TREND_SERIES.some((series) => Number(item[series.key] || 0) > 0),
        ),
      ),
    [analytics],
  )

  const hasRiskDistribution = useMemo(
    () => Boolean(analytics?.risk_level_counts.some((item) => item.value > 0)),
    [analytics],
  )

  const hasFraudTypeDistribution = useMemo(
    () => Boolean(analytics?.fraud_type_counts.some((item) => item.value > 0)),
    [analytics],
  )

  const hasRagStatus = useMemo(
    () => Boolean(analytics?.rag_status_counts.some((item) => item.value > 0)),
    [analytics],
  )

  const hasRagTrend = useMemo(
    () =>
      Boolean(
        analytics?.rag_sync_trend.some(
          (item) => Number(item["向量化源数"] || 0) > 0 || Number(item["向量块数"] || 0) > 0,
        ),
      ),
    [analytics],
  )

  if (loading && !dashboard && !analytics) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center">
        <div className="inline-flex items-center gap-3 rounded-full border border-border bg-card px-4 py-2 text-sm text-muted-foreground">
          <Spinner className="size-4" />
          正在加载可视化
        </div>
      </div>
    )
  }

  if (error && !dashboard && !analytics) {
    return (
      <Card className="bg-card border-border">
        <CardContent className="py-16 flex flex-col items-center gap-4 text-center">
          <AlertTriangle className="h-8 w-8 text-destructive" />
          <div className="space-y-1">
            <p className="text-sm text-foreground">概览加载失败</p>
            <p className="text-xs text-muted-foreground">{error}</p>
          </div>
          <Button onClick={() => void loadData()}>
            <RefreshCw className="h-4 w-4" />
            重试
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <section aria-labelledby="stats-heading" className="space-y-3">
        <h2 id="stats-heading" className="sr-only">
          关键指标
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 md:gap-4">
          {metricCards.map((item) => {
            const Icon = item.icon
            return (
              <Card key={item.label} className="bg-card border-border">
                <CardContent className="p-4 md:p-5">
                  <div className={`h-9 w-9 rounded-md flex items-center justify-center ${metricToneClass(item.tone)}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <p className="mt-4 text-xs text-muted-foreground">{item.label}</p>
                  <p className="mt-1 text-2xl font-semibold text-foreground tabular-nums">
                    {item.value.toLocaleString()}
                  </p>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        <Card className="lg:col-span-2 bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div>
              <CardTitle className="text-base">检测趋势</CardTitle>
              <CardDescription>近 7 天</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              {TREND_SERIES.map((item) => (
                <span key={item.key} className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: item.color }} />
                  {item.label}
                </span>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            {hasDetectionTrend && analytics ? (
              <DetectionTrendChart data={analytics.detection_trend} series={TREND_SERIES} />
            ) : (
              <div className="h-72 flex items-center justify-center text-sm text-muted-foreground">暂无检测数据</div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">RAG 向量化概况</CardTitle>
            <CardDescription>{analytics?.rag_overview.embedding_model || "当前模型"}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {hasRagStatus && analytics ? (
              <RagStatusChart data={analytics.rag_status_counts} />
            ) : (
              <div className="h-52 flex items-center justify-center text-sm text-muted-foreground">暂无向量化数据</div>
            )}

            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg border border-border bg-background/50 p-3">
                <dt className="text-xs text-muted-foreground">知识总数</dt>
                <dd className="mt-1 text-lg font-semibold text-foreground tabular-nums">
                  {(analytics?.rag_overview.source_total ?? 0).toLocaleString()}
                </dd>
              </div>
              <div className="rounded-lg border border-border bg-background/50 p-3">
                <dt className="text-xs text-muted-foreground">向量块总数</dt>
                <dd className="mt-1 text-lg font-semibold text-foreground tabular-nums">
                  {(analytics?.rag_overview.chunk_total ?? 0).toLocaleString()}
                </dd>
              </div>
              <div className="rounded-lg border border-border bg-background/50 p-3">
                <dt className="text-xs text-muted-foreground">待处理</dt>
                <dd className="mt-1 text-lg font-semibold text-foreground tabular-nums">
                  {(analytics?.rag_overview.pending_total ?? 0).toLocaleString()}
                </dd>
              </div>
              <div className="rounded-lg border border-border bg-background/50 p-3">
                <dt className="text-xs text-muted-foreground">最近完成</dt>
                <dd className="mt-1 text-sm font-medium text-foreground">
                  {analytics?.rag_overview.latest_synced_at
                    ? formatFullDateTime(analytics.rag_overview.latest_synced_at)
                    : "暂无"}
                </dd>
              </div>
            </dl>

            <Button variant="outline" size="sm" className="w-full border-border bg-transparent" asChild>
              <Link href="/admin/knowledge">
                <BookOpen className="h-3.5 w-3.5" />
                打开知识库
              </Link>
            </Button>
          </CardContent>
        </Card>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">风险分布</CardTitle>
            <CardDescription>检测结果</CardDescription>
          </CardHeader>
          <CardContent>
            {hasRiskDistribution && analytics ? (
              <RiskDistributionChart data={analytics.risk_level_counts} />
            ) : (
              <div className="h-72 flex items-center justify-center text-sm text-muted-foreground">暂无风险结果</div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">诈骗类型分布</CardTitle>
            <CardDescription>Top 7</CardDescription>
          </CardHeader>
          <CardContent>
            {hasFraudTypeDistribution && analytics ? (
              <InterferenceTypesChart data={analytics.fraud_type_counts} />
            ) : (
              <div className="h-72 flex items-center justify-center text-sm text-muted-foreground">暂无类型结果</div>
            )}
          </CardContent>
        </Card>
      </section>

      <Card className="bg-card border-border">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              向量化数量
            </CardTitle>
            <CardDescription>近 7 天</CardDescription>
          </div>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/admin/knowledge">
              查看知识库
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="space-y-5">
          {hasRagTrend && analytics ? (
            <RagSyncTrendChart data={analytics.rag_sync_trend} />
          ) : (
            <div className="h-72 flex items-center justify-center text-sm text-muted-foreground">暂无向量化趋势</div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {(analytics?.rag_status_counts || []).map((item) => (
              <div key={item.label} className="rounded-xl border border-border bg-background/50 p-4">
                <p className="text-xs text-muted-foreground">{item.label}</p>
                <p className="mt-2 text-xl font-semibold text-foreground tabular-nums">
                  {item.value.toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}
