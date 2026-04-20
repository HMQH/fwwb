"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Check, CheckCheck, Eye, Globe, Plus, Search, X } from "lucide-react"
import { useAdminSession } from "@/components/admin/admin-session-provider"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import {
  approveAllAdminCases,
  fetchAdminCases,
  fetchAdminDashboard,
  reviewAdminCase,
  syncAdminCases,
  type AdminCaseItem,
  type AdminDashboardResponse,
} from "@/lib/admin-api"
import { formatFullDateTime, formatRelativeTime, REVIEW_STATUS_LABELS } from "@/lib/admin-format"

type CaseFilter = "all" | "pending" | "approved" | "rejected"

const CUSTOM_CASE_SOURCES_KEY = "admin-case-custom-sources"

function reviewStatusTone(status: string) {
  if (status === "approved") return "border-chart-4/30 bg-chart-4/15 text-chart-4"
  if (status === "rejected") return "border-border bg-muted text-muted-foreground"
  return "border-chart-2/30 bg-chart-2/15 text-chart-2"
}

function syncStatusTone(status?: string | null) {
  if (status === "completed") return "border-chart-4/30 bg-chart-4/10 text-chart-4"
  if (status === "failed") return "border-destructive/30 bg-destructive/10 text-destructive"
  return "border-chart-2/30 bg-chart-2/10 text-chart-2"
}

function getCaseTimeValue(item: AdminCaseItem) {
  const timestamp = new Date(
    item.source_published_at || item.updated_at || item.created_at || item.reviewed_at || 0,
  ).getTime()
  return Number.isNaN(timestamp) ? 0 : timestamp
}

export default function CasesPage() {
  const { accessToken } = useAdminSession()
  const [dashboard, setDashboard] = useState<AdminDashboardResponse | null>(null)
  const [items, setItems] = useState<AdminCaseItem[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<CaseFilter>("all")
  const [keyword, setKeyword] = useState("")
  const [detailId, setDetailId] = useState<string | null>(null)
  const [reviewNote, setReviewNote] = useState("")
  const [approveAllOpen, setApproveAllOpen] = useState(false)
  const [sourceInput, setSourceInput] = useState("")
  const [customSources, setCustomSources] = useState<string[]>([])

  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      const raw = window.localStorage.getItem(CUSTOM_CASE_SOURCES_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        setCustomSources(parsed.map((item) => String(item).trim()).filter(Boolean))
      }
    } catch {
      window.localStorage.removeItem(CUSTOM_CASE_SOURCES_KEY)
    }
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return
    window.localStorage.setItem(CUSTOM_CASE_SOURCES_KEY, JSON.stringify(customSources))
  }, [customSources])

  const loadData = useCallback(async () => {
    if (!accessToken) return

    setLoading(true)
    setError(null)
    try {
      const [dashboardData, casesData] = await Promise.all([
        fetchAdminDashboard(accessToken),
        fetchAdminCases(accessToken, { limit: 300 }),
      ])
      setDashboard(dashboardData)
      setItems(casesData.items)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "加载失败")
    } finally {
      setLoading(false)
    }
  }, [accessToken])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const counts = useMemo(
    () => ({
      pending: items.filter((item) => item.review_status === "pending").length,
      approved: items.filter((item) => item.review_status === "approved").length,
      rejected: items.filter((item) => item.review_status === "rejected").length,
    }),
    [items],
  )

  const filteredItems = useMemo(() => {
    return [...items]
      .filter((item) => {
        const matchFilter = filter === "all" ? true : item.review_status === filter
        const matchKeyword =
          !keyword.trim() ||
          [item.title, item.summary, item.source_name, item.source_article_title, item.fraud_type]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(keyword.trim().toLowerCase()))
        return matchFilter && matchKeyword
      })
      .sort((left, right) => {
        const timeDiff = getCaseTimeValue(right) - getCaseTimeValue(left)
        if (timeDiff !== 0) return timeDiff
        return String(right.id).localeCompare(String(left.id))
      })
  }, [filter, items, keyword])

  const activeItem =
    filteredItems.find((item) => item.id === detailId) || items.find((item) => item.id === detailId) || null

  const handleAddSource = () => {
    const value = sourceInput.trim()
    if (!value) return

    try {
      const normalized = new URL(value).toString()
      setCustomSources((current) => (current.includes(normalized) ? current : [...current, normalized]))
      setSourceInput("")
      setError(null)
    } catch {
      setError("来源链接格式不正确")
    }
  }

  const handleRemoveSource = (source: string) => {
    setCustomSources((current) => current.filter((item) => item !== source))
  }

  const handleSync = async () => {
    if (!accessToken) return

    setSubmitting(true)
    setError(null)
    try {
      await syncAdminCases(accessToken, customSources)
      await loadData()
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "同步失败")
    } finally {
      setSubmitting(false)
    }
  }

  const handleApproveAll = async () => {
    if (!accessToken) return

    setSubmitting(true)
    setError(null)
    try {
      await approveAllAdminCases(accessToken, "批量通过")
      setApproveAllOpen(false)
      await loadData()
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "批量通过失败")
    } finally {
      setSubmitting(false)
    }
  }

  const handleReview = async (action: "approve" | "reject") => {
    if (!accessToken || !detailId) return

    setSubmitting(true)
    setError(null)
    try {
      await reviewAdminCase(accessToken, detailId, action, reviewNote)
      setDetailId(null)
      setReviewNote("")
      await loadData()
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "提交失败")
    } finally {
      setSubmitting(false)
    }
  }

  if (loading && !dashboard) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="inline-flex items-center gap-3 rounded-full border border-border bg-card px-4 py-2 text-sm text-muted-foreground">
          <Spinner className="size-4" />
          正在加载案例
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Card className="border-border bg-card">
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0 pb-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Globe className="h-4 w-4 text-primary" />
              案例抓取
            </CardTitle>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <AlertDialog open={approveAllOpen} onOpenChange={setApproveAllOpen}>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="border-border bg-transparent" disabled={submitting || counts.pending === 0}>
                  <CheckCheck className="h-4 w-4" />
                  全部通过
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>全部通过待审核案例？</AlertDialogTitle>
                  <AlertDialogDescription>当前待审核 {counts.pending} 条。</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>取消</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void handleApproveAll()} disabled={submitting}>
                    确认
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <Button onClick={() => void handleSync()} disabled={submitting}>
              {submitting ? <Spinner className="size-4" /> : <Plus className="h-4 w-4" />}
              同步更新
            </Button>
          </div>
        </CardHeader>

        <CardContent className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
          <div className="rounded-lg border border-border bg-background/40 p-4">
            <p className="mb-2 text-xs text-muted-foreground">官方来源</p>
            <div className="flex flex-wrap gap-2">
              {(dashboard?.official_sources || []).map((source) => (
                <Badge key={source} variant="outline" className="border-border bg-card text-foreground">
                  {source}
                </Badge>
              ))}
              {(dashboard?.official_sources || []).length === 0 ? (
                <span className="text-xs text-muted-foreground">暂无来源</span>
              ) : null}
            </div>

            <div className="mt-4 space-y-3 border-t border-border/60 pt-4">
              <Label htmlFor="case-source-input" className="text-xs text-muted-foreground">
                添加来源
              </Label>
              <div className="flex flex-col gap-2 md:flex-row">
                <Input
                  id="case-source-input"
                  value={sourceInput}
                  onChange={(event) => setSourceInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault()
                      handleAddSource()
                    }
                  }}
                  placeholder="https://example.com/article.html"
                  className="h-10 border-border bg-card"
                />
                <Button type="button" variant="outline" className="border-border bg-transparent" onClick={handleAddSource}>
                  <Plus className="h-4 w-4" />
                  添加来源
                </Button>
              </div>

              {customSources.length ? (
                <ul className="space-y-2">
                  {customSources.map((source) => (
                    <li
                      key={source}
                      className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground"
                    >
                      <span className="min-w-0 flex-1 truncate font-mono">{source}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => handleRemoveSource(source)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-background/40 p-4">
            <p className="text-xs text-muted-foreground">最近同步</p>
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">完成时间</span>
                <span className="text-right text-foreground tabular-nums">
                  {formatFullDateTime(dashboard?.latest_case_sync?.finished_at ?? dashboard?.latest_case_sync?.started_at)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">新增</span>
                <span className="tabular-nums text-chart-4">{dashboard?.latest_case_sync?.inserted_count ?? 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">更新</span>
                <span className="tabular-nums text-foreground">{dashboard?.latest_case_sync?.updated_count ?? 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">状态</span>
                <Badge variant="outline" className={syncStatusTone(dashboard?.latest_case_sync?.status)}>
                  {dashboard?.latest_case_sync?.status === "completed" ? "成功" : dashboard?.latest_case_sync?.status || "未开始"}
                </Badge>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardContent className="flex flex-col gap-3 p-4 md:p-5 lg:flex-row lg:items-center">
          <Tabs value={filter} onValueChange={(value) => setFilter(value as CaseFilter)} className="shrink-0">
            <TabsList className="border border-border bg-muted/60">
              <TabsTrigger value="all">全部（{items.length}）</TabsTrigger>
              <TabsTrigger value="pending">待审核（{counts.pending}）</TabsTrigger>
              <TabsTrigger value="approved">已通过（{counts.approved}）</TabsTrigger>
              <TabsTrigger value="rejected">已驳回（{counts.rejected}）</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索标题 / 来源 / 类型"
              className="h-10 border-border bg-input/60 pl-9"
            />
          </div>

          <div className="text-xs text-muted-foreground">
            当前 <span className="tabular-nums text-foreground">{filteredItems.length}</span>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">案例列表</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
              <Spinner className="mr-2 size-4" />
              正在刷新
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">暂无匹配案例</div>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {filteredItems.map((item) => (
                <li key={item.id} className="px-5 py-4 transition-colors hover:bg-accent/30">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">{item.id.slice(0, 8)}</span>
                        <Badge variant="outline" className={`px-1.5 py-0 text-[10px] ${reviewStatusTone(item.review_status)}`}>
                          {REVIEW_STATUS_LABELS[item.review_status] || item.review_status}
                        </Badge>
                        <Badge variant="outline" className="border-primary/30 bg-primary/10 px-1.5 py-0 text-[10px] text-primary">
                          {item.fraud_type || "未分类"}
                        </Badge>
                      </div>

                      <p className="mt-2 text-sm font-medium text-foreground">{item.title}</p>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.summary || "暂无摘要"}</p>

                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {(item.tags || []).slice(0, 4).map((tag) => (
                          <Badge
                            key={tag}
                            variant="outline"
                            className="border-border bg-muted/60 px-1.5 py-0 text-[10px] text-muted-foreground"
                          >
                            #{tag}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-col items-start gap-2 md:items-end">
                      <div className="text-left text-xs text-muted-foreground md:text-right">
                        <p>{item.source_name || "未知来源"}</p>
                        <p className="tabular-nums">{formatRelativeTime(item.source_published_at || item.updated_at || item.created_at)}</p>
                      </div>
                      <Button variant="outline" size="sm" className="border-border bg-transparent" onClick={() => setDetailId(item.id)}>
                        <Eye className="h-3.5 w-3.5" />
                        查看
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(activeItem)} onOpenChange={(open) => (!open ? setDetailId(null) : undefined)}>
        <DialogContent className="sm:max-w-3xl">
          {activeItem ? (
            <>
              <DialogHeader>
                <DialogTitle className="text-left">{activeItem.title}</DialogTitle>
                <DialogDescription className="text-left">
                  {activeItem.source_name || "未知来源"} · {formatFullDateTime(activeItem.source_published_at || activeItem.created_at)}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={reviewStatusTone(activeItem.review_status)}>
                    {REVIEW_STATUS_LABELS[activeItem.review_status] || activeItem.review_status}
                  </Badge>
                  <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
                    {activeItem.fraud_type || "未分类"}
                  </Badge>
                  {activeItem.source_article_url ? (
                    <a
                      href={activeItem.source_article_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-primary underline underline-offset-4"
                    >
                      打开原文
                    </a>
                  ) : null}
                </div>

                <Card className="border-border bg-background/40">
                  <CardContent className="space-y-3 p-4">
                    <div>
                      <p className="text-xs text-muted-foreground">摘要</p>
                      <p className="mt-1 text-sm leading-6 text-foreground">{activeItem.summary || "暂无摘要"}</p>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div>
                        <p className="text-xs text-muted-foreground">风险信号</p>
                        <ul className="mt-2 space-y-1 text-sm text-foreground">
                          {(activeItem.warning_signs || []).length ? (
                            activeItem.warning_signs.slice(0, 6).map((item) => <li key={item}>• {item}</li>)
                          ) : (
                            <li className="text-muted-foreground">暂无</li>
                          )}
                        </ul>
                      </div>

                      <div>
                        <p className="text-xs text-muted-foreground">防护建议</p>
                        <ul className="mt-2 space-y-1 text-sm text-foreground">
                          {(activeItem.prevention_actions || []).length ? (
                            activeItem.prevention_actions.slice(0, 6).map((item) => <li key={item}>• {item}</li>)
                          ) : (
                            <li className="text-muted-foreground">暂无</li>
                          )}
                        </ul>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {activeItem.review_status === "pending" ? (
                  <div className="space-y-2">
                    <Label htmlFor="review-note" className="text-sm">
                      审核备注
                    </Label>
                    <Textarea
                      id="review-note"
                      value={reviewNote}
                      onChange={(event) => setReviewNote(event.target.value)}
                      rows={4}
                      placeholder="可选"
                    />
                  </div>
                ) : (
                  <div className="rounded-lg border border-border bg-background/40 p-4 text-sm">
                    <p className="text-xs text-muted-foreground">审核信息</p>
                    <p className="mt-2 text-foreground">{activeItem.review_note || "无备注"}</p>
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                      <span>{activeItem.reviewed_by || "系统"}</span>
                      <span>{formatFullDateTime(activeItem.reviewed_at)}</span>
                    </div>
                  </div>
                )}
              </div>

              <DialogFooter className="gap-2">
                {activeItem.review_status === "pending" ? (
                  <>
                    <Button variant="ghost" onClick={() => setDetailId(null)}>
                      关闭
                    </Button>
                    <Button
                      variant="outline"
                      className="border-destructive/30 text-destructive"
                      onClick={() => void handleReview("reject")}
                      disabled={submitting}
                    >
                      <X className="h-4 w-4" />
                      驳回
                    </Button>
                    <Button onClick={() => void handleReview("approve")} disabled={submitting}>
                      <Check className="h-4 w-4" />
                      通过
                    </Button>
                  </>
                ) : (
                  <Button onClick={() => setDetailId(null)}>关闭</Button>
                )}
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}
