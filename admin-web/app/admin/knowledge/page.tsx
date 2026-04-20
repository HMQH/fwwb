"use client"

import type React from "react"

import { useCallback, useEffect, useMemo, useState } from "react"
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
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { useAdminSession } from "@/components/admin/admin-session-provider"
import {
  deleteKnowledgeSource,
  fetchKnowledgeSources,
  importKnowledgeFile,
  importKnowledgeText,
  type AdminSourceItem,
} from "@/lib/admin-api"
import { formatDate, SAMPLE_LABELS, truncateText } from "@/lib/admin-format"
import { BookOpen, FilePlus2, FileText, Search, Trash2, Upload } from "lucide-react"

function sourceTone(sourceType: string) {
  if (sourceType === "案例审核") return "bg-primary/15 text-primary border-primary/30"
  if (sourceType === "文件上传") return "bg-chart-2/15 text-chart-2 border-chart-2/30"
  return "bg-muted text-muted-foreground border-border"
}

function getSourceTimeValue(value?: string | null) {
  if (!value) return 0
  const timestamp = new Date(value).getTime()
  return Number.isNaN(timestamp) ? 0 : timestamp
}

export default function KnowledgePage() {
  const { accessToken } = useAdminSession()
  const [items, setItems] = useState<AdminSourceItem[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [keyword, setKeyword] = useState("")
  const [textOpen, setTextOpen] = useState(false)
  const [fileOpen, setFileOpen] = useState(false)
  const [textTitle, setTextTitle] = useState("")
  const [textFraudType, setTextFraudType] = useState("")
  const [textUrl, setTextUrl] = useState("")
  const [textBody, setTextBody] = useState("")
  const [fileTitle, setFileTitle] = useState("")
  const [fileFraudType, setFileFraudType] = useState("")
  const [selectedFile, setSelectedFile] = useState<File | null>(null)

  const loadData = useCallback(async () => {
    if (!accessToken) return

    setLoading(true)
    setError(null)
    try {
      const data = await fetchKnowledgeSources(accessToken, { limit: 200 })
      setItems(data.items)
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
    return [...items]
      .filter((item) => {
        const matchKeyword =
          !keyword.trim() ||
          [item.title, item.summary, item.fraud_type, item.data_source].some((value) =>
            String(value || "")
              .toLowerCase()
              .includes(keyword.trim().toLowerCase()),
          )
        return matchKeyword
      })
      .sort((left, right) => {
        const timeDiff = getSourceTimeValue(right.created_at) - getSourceTimeValue(left.created_at)
        if (timeDiff !== 0) return timeDiff
        return right.id - left.id
      })
  }, [items, keyword])

  const handleDelete = async (sourceId: number) => {
    if (!accessToken) return

    setSubmitting(true)
    setError(null)
    try {
      await deleteKnowledgeSource(accessToken, sourceId)
      await loadData()
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "删除失败")
    } finally {
      setSubmitting(false)
    }
  }

  const handleTextSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!accessToken) return
    if (!textBody.trim()) return

    setSubmitting(true)
    setError(null)
    try {
      await importKnowledgeText(accessToken, {
        title: textTitle.trim() || null,
        content: textBody.trim(),
        sample_label: "white",
        fraud_type: textFraudType.trim() || null,
        url: textUrl.trim() || null,
        data_source: "admin_manual",
      })
      setTextTitle("")
      setTextFraudType("")
      setTextUrl("")
      setTextBody("")
      setTextOpen(false)
      await loadData()
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "录入失败")
    } finally {
      setSubmitting(false)
    }
  }

  const handleFileSubmit = async () => {
    if (!accessToken || !selectedFile) return

    setSubmitting(true)
    setError(null)
    try {
      await importKnowledgeFile(accessToken, {
        file: selectedFile,
        title: fileTitle.trim() || undefined,
        fraudType: fileFraudType.trim() || undefined,
        sampleLabel: "white",
        dataSource: "admin_upload_file",
      })
      setSelectedFile(null)
      setFileTitle("")
      setFileFraudType("")
      setFileOpen(false)
      await loadData()
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "上传失败")
    } finally {
      setSubmitting(false)
    }
  }

  if (loading && items.length === 0) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center">
        <div className="inline-flex items-center gap-3 rounded-full border border-border bg-card px-4 py-2 text-sm text-muted-foreground">
          <Spinner className="size-4" />
          正在加载知识库
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Card className="bg-card border-border">
        <CardContent className="p-4 md:p-5 flex flex-col lg:flex-row gap-3 lg:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索标题 / 摘要 / 类型"
              className="pl-9 bg-input/60 border-border h-10"
            />
          </div>

          <div className="flex gap-2">
            <Dialog open={textOpen} onOpenChange={setTextOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" className="border-border bg-transparent">
                  <FilePlus2 className="h-4 w-4" />
                  <span className="hidden sm:inline">手动录入</span>
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>新增资料</DialogTitle>
                  <DialogDescription>写入 sources_all_data</DialogDescription>
                </DialogHeader>
                <form onSubmit={handleTextSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="k-title">标题</Label>
                    <Input id="k-title" value={textTitle} onChange={(event) => setTextTitle(event.target.value)} placeholder="可选" />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="k-type">诈骗类型</Label>
                      <Input
                        id="k-type"
                        value={textFraudType}
                        onChange={(event) => setTextFraudType(event.target.value)}
                        placeholder="如：冒充客服"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="k-url">来源链接</Label>
                      <Input
                        id="k-url"
                        value={textUrl}
                        onChange={(event) => setTextUrl(event.target.value)}
                        placeholder="可选"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="k-body">内容</Label>
                    <Textarea
                      id="k-body"
                      value={textBody}
                      onChange={(event) => setTextBody(event.target.value)}
                      placeholder="请输入内容"
                      rows={7}
                      required
                    />
                  </div>
                  <DialogFooter>
                    <Button type="button" variant="ghost" onClick={() => setTextOpen(false)}>
                      取消
                    </Button>
                    <Button type="submit" disabled={submitting}>
                      {submitting ? (
                        <>
                          <Spinner className="size-4" />
                          提交中
                        </>
                      ) : (
                        "确认录入"
                      )}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>

            <Dialog open={fileOpen} onOpenChange={setFileOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Upload className="h-4 w-4" />
                  <span className="hidden sm:inline">上传文件</span>
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>上传资料</DialogTitle>
                  <DialogDescription>后端会解析文本并写入知识库</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="file-title">标题</Label>
                      <Input
                        id="file-title"
                        value={fileTitle}
                        onChange={(event) => setFileTitle(event.target.value)}
                        placeholder="可选"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="file-type">诈骗类型</Label>
                      <Input
                        id="file-type"
                        value={fileFraudType}
                        onChange={(event) => setFileFraudType(event.target.value)}
                        placeholder="可选"
                      />
                    </div>
                  </div>

                  <label
                    htmlFor="file-input"
                    className="block rounded-lg border-2 border-dashed border-border bg-background/40 p-10 text-center cursor-pointer hover:border-primary/50 transition-colors"
                  >
                    <Upload className="h-8 w-8 text-muted-foreground mx-auto" />
                    <p className="mt-3 text-sm text-foreground">{selectedFile ? selectedFile.name : "点击选择文件"}</p>
                    <p className="mt-1 text-xs text-muted-foreground">PDF / DOC / DOCX / TXT</p>
                    <input
                      id="file-input"
                      type="file"
                      className="sr-only"
                      onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
                    />
                  </label>
                </div>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setFileOpen(false)}>
                    取消
                  </Button>
                  <Button onClick={() => void handleFileSubmit()} disabled={!selectedFile || submitting}>
                    {submitting ? (
                      <>
                        <Spinner className="size-4" />
                        上传中
                      </>
                    ) : (
                      "开始上传"
                    )}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-primary" />
              知识库资料
            </CardTitle>
            <CardDescription>
              当前 <span className="text-foreground tabular-nums">{filteredItems.length}</span> / {items.length}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {filteredItems.length === 0 ? (
            <div className="py-16 text-center">
              <FileText className="h-8 w-8 text-muted-foreground mx-auto" />
              <p className="mt-3 text-sm text-muted-foreground">暂无匹配资料</p>
            </div>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {filteredItems.map((item) => (
                <li key={item.id} className="px-5 py-4 hover:bg-accent/40 transition-colors">
                  <div className="flex flex-col md:flex-row md:items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-muted-foreground font-mono">#{item.id}</span>
                        <Badge variant="outline" className={`${sourceTone(item.source_type)} text-[10px] px-1.5 py-0`}>
                          {item.source_type}
                        </Badge>
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-muted/60 border-border text-muted-foreground">
                          {SAMPLE_LABELS[item.sample_label] || item.sample_label}
                        </Badge>
                        <span className="text-xs text-muted-foreground">创建于 {formatDate(item.created_at)}</span>
                      </div>
                      <h3 className="mt-1.5 text-sm font-medium text-foreground">{item.title}</h3>
                      <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{truncateText(item.summary, 120)}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {item.tags.map((tag) => (
                          <Badge
                            key={tag}
                            variant="outline"
                            className="text-[10px] px-1.5 py-0 bg-muted/60 border-border text-muted-foreground"
                          >
                            #{tag}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    <div className="flex md:flex-col gap-2 shrink-0">
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10">
                            <Trash2 className="h-3.5 w-3.5" />
                            删除
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>确认删除这条资料？</AlertDialogTitle>
                            <AlertDialogDescription>{item.title}</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>取消</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => void handleDelete(item.id)}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              删除
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
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
