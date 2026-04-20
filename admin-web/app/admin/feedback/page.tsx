"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { CheckCircle2, MessageSquareWarning, Search, ShieldAlert, ShieldCheck, TrendingUp } from "lucide-react"
import { FeedbackTrendChart } from "@/components/admin/charts/feedback-trend"
import { useAdminSession } from "@/components/admin/admin-session-provider"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { fetchAdminAnalytics, fetchAdminFeedback, type AdminAnalyticsResponse, type AdminFeedbackItem } from "@/lib/admin-api"
import { FEEDBACK_USER_LABELS, formatFullDateTime } from "@/lib/admin-format"

type FeedbackFilter = "all" | "fraud" | "safe"

function verdictClass(label: string) {
  return label === "fraud"
    ? "bg-destructive/15 text-destructive border-destructive/30"
    : "bg-chart-4/15 text-chart-4 border-chart-4/30"
}

function effectiveClass(label: string) {
  if (label === "有效") return "bg-chart-4/15 text-chart-4 border-chart-4/30"
  if (label === "无效") return "bg-muted text-muted-foreground border-border"
  return "bg-chart-2/15 text-chart-2 border-chart-2/30"
}

export default function FeedbackPage() {
  const { accessToken } = useAdminSession()
  const [analytics, setAnalytics] = useState<AdminAnalyticsResponse | null>(null)
  const [items, setItems] = useState<AdminFeedbackItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<FeedbackFilter>("all")
  const [keyword, setKeyword] = useState("")

  const loadData = useCallback(async () => {
    if (!accessToken) return

    setLoading(true)
    setError(null)
    try {
      const [analyticsData, feedbackData] = await Promise.all([
        fetchAdminAnalytics(accessToken),
        fetchAdminFeedback(accessToken, 200),
      ])
      setAnalytics(analyticsData)
      setItems(feedbackData.items)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "加载失败")
    } finally {
      setLoading(false)
    }
  }, [accessToken])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const matchFilter = filter === "all" ? true : item.user_label === filter
      const matchKeyword =
        !keyword.trim() ||
        [item.preview, item.note, item.user_display_name, item.user_phone_masked, item.correction_type]
          .some((value) => String(value || "").toLowerCase().includes(keyword.trim().toLowerCase()))
      return matchFilter && matchKeyword
    })
  }, [filter, items, keyword])

  const totalCorrection = analytics?.feedback_correction_counts.reduce((sum, item) => sum + item.value, 0) ?? 0

  if (loading && !analytics) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center">
        <div className="inline-flex items-center gap-3 rounded-full border border-border bg-card px-4 py-2 text-sm text-muted-foreground">
          <Spinner className="size-4" />
          正在加载反馈
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <Card className="bg-card border-border">
          <CardContent className="p-4 md:p-5">
            <div className="flex items-start justify-between">
              <div className="h-9 w-9 rounded-md bg-primary/15 text-primary flex items-center justify-center">
                <MessageSquareWarning className="h-4 w-4" />
              </div>
              <span className="text-xs text-muted-foreground">总量</span>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">反馈总数</p>
            <p className="mt-1 text-2xl font-semibold text-foreground tabular-nums">
              {analytics?.feedback_summary.total.toLocaleString() ?? "0"}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="p-4 md:p-5">
            <div className="flex items-start justify-between">
              <div className="h-9 w-9 rounded-md bg-destructive/15 text-destructive flex items-center justify-center">
                <ShieldAlert className="h-4 w-4" />
              </div>
              <span className="text-xs text-muted-foreground">用户判定</span>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">诈骗</p>
            <p className="mt-1 text-2xl font-semibold text-foreground tabular-nums">
              {analytics?.feedback_summary.fraud_total.toLocaleString() ?? "0"}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="p-4 md:p-5">
            <div className="flex items-start justify-between">
              <div className="h-9 w-9 rounded-md bg-chart-4/15 text-chart-4 flex items-center justify-center">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <span className="text-xs text-muted-foreground">用户判定</span>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">安全</p>
            <p className="mt-1 text-2xl font-semibold text-foreground tabular-nums">
              {analytics?.feedback_summary.safe_total.toLocaleString() ?? "0"}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="p-4 md:p-5">
            <div className="flex items-start justify-between">
              <div className="h-9 w-9 rounded-md bg-chart-2/15 text-chart-2 flex items-center justify-center">
                <CheckCircle2 className="h-4 w-4" />
              </div>
              <span className="text-xs inline-flex items-center gap-0.5 text-chart-4">
                <TrendingUp className="h-3 w-3" />
                有效
              </span>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">有效建议</p>
            <p className="mt-1 text-2xl font-semibold text-foreground tabular-nums">
              {analytics?.feedback_summary.helpful_total.toLocaleString() ?? "0"}
            </p>
          </CardContent>
        </Card>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        <Card className="lg:col-span-2 bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">反馈趋势</CardTitle>
            <CardDescription>近 7 日</CardDescription>
          </CardHeader>
          <CardContent>
            {analytics?.feedback_trend.some((item) => item.总数 > 0) ? (
              <FeedbackTrendChart data={analytics.feedback_trend} />
            ) : (
              <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">暂无反馈数据</div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">修正类型</CardTitle>
            <CardDescription>自动归类</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {(analytics?.feedback_correction_counts || []).map((item) => {
              const pct = totalCorrection > 0 ? (item.value / totalCorrection) * 100 : 0
              return (
                <div key={item.label}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-foreground">{item.label}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {item.value} · {pct.toFixed(1)}%
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${pct}%` }}
                      aria-hidden="true"
                    />
                  </div>
                </div>
              )
            })}
            {analytics?.feedback_correction_counts.length === 0 ? (
              <div className="text-sm text-muted-foreground">暂无修正数据</div>
            ) : null}
          </CardContent>
        </Card>
      </section>

      <Card className="bg-card border-border">
        <CardContent className="p-4 md:p-5 flex flex-col lg:flex-row gap-3 lg:items-center">
          <Tabs value={filter} onValueChange={(value) => setFilter(value as FeedbackFilter)} className="shrink-0">
            <TabsList className="bg-muted/60 border border-border">
              <TabsTrigger value="all">全部（{items.length}）</TabsTrigger>
              <TabsTrigger value="fraud">诈骗（{items.filter((item) => item.user_label === "fraud").length}）</TabsTrigger>
              <TabsTrigger value="safe">安全（{items.filter((item) => item.user_label === "safe").length}）</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索用户 / 内容 / 备注"
              className="pl-9 bg-input/60 border-border h-10"
            />
          </div>
          <div className="text-xs text-muted-foreground">
            当前 <span className="text-foreground tabular-nums">{filteredItems.length}</span>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">反馈列表</CardTitle>
          <CardDescription>来自 detection_feedback</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="py-16 flex items-center justify-center text-sm text-muted-foreground">
              <Spinner className="size-4 mr-2" />
              正在刷新
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">暂无匹配反馈</div>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {filteredItems.map((item) => (
                <li key={item.id} className="px-5 py-4 hover:bg-accent/30 transition-colors">
                  <div className="flex flex-col md:flex-row md:items-start gap-3 md:gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-muted-foreground font-mono">{item.id.slice(0, 8)}</span>
                        <Badge variant="outline" className={`${verdictClass(item.user_label)} text-[10px] px-1.5 py-0`}>
                          用户判定：{FEEDBACK_USER_LABELS[item.user_label] || item.user_label}
                        </Badge>
                        <Badge variant="outline" className={`${effectiveClass(item.effective_status)} text-[10px] px-1.5 py-0`}>
                          {item.effective_status}
                        </Badge>
                        <Badge
                          variant="outline"
                          className="bg-muted/60 border-border text-muted-foreground text-[10px] px-1.5 py-0"
                        >
                          {item.correction_type}
                        </Badge>
                      </div>

                      <p className="mt-2 text-sm text-foreground leading-relaxed">{item.preview || "无文本预览"}</p>

                      <p className="mt-1.5 text-xs text-muted-foreground">
                        <span className="text-foreground">备注：</span>
                        {item.note || "无"}
                      </p>
                    </div>

                    <div className="flex md:flex-col md:items-end gap-2 md:gap-1 text-xs text-muted-foreground shrink-0">
                      <span>{item.user_display_name || item.user_phone_masked || item.user_id.slice(0, 8)}</span>
                      <span className="tabular-nums">{formatFullDateTime(item.created_at)}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}
