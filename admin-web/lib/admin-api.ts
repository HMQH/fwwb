export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "")

export class AdminApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = "AdminApiError"
    this.status = status
  }
}

export type AdminUser = {
  id: string
  phone: string
  display_name: string
  role: string
  birth_date: string
  avatar_url?: string | null
  guardian_relation?: string | null
  is_admin: boolean
}

export type AdminLoginResponse = {
  access_token: string
  token_type: string
  user: AdminUser
}

export type AdminCaseItem = {
  id: string
  source_name?: string | null
  source_domain?: string | null
  source_article_title?: string | null
  source_article_url?: string | null
  title: string
  summary?: string | null
  content_type?: string | null
  fraud_type?: string | null
  cover_url?: string | null
  tags: string[]
  target_roles: string[]
  warning_signs: string[]
  prevention_actions: string[]
  flow_nodes: Array<Record<string, unknown>>
  media_assets: Array<Record<string, unknown>>
  detail_blocks: Array<{ title?: string; paragraphs?: string[] }>
  source_published_at?: string | null
  published_at?: string | null
  last_synced_at?: string | null
  status: string
  review_status: string
  review_note?: string | null
  reviewed_by?: string | null
  reviewed_at?: string | null
  knowledge_source_id?: number | null
  created_at?: string | null
  updated_at?: string | null
}

export type AdminDashboardResponse = {
  stats: Record<string, number>
  latest_case_sync?: {
    id: string
    source_name: string
    status: string
    discovered_count: number
    inserted_count: number
    updated_count: number
    skipped_count: number
    error_message?: string | null
    detail?: Record<string, unknown> | null
    started_at?: string | null
    finished_at?: string | null
    created_at?: string | null
    updated_at?: string | null
  } | null
  official_sources: string[]
  seed_urls: string[]
  pending_cases: AdminCaseItem[]
}

export type AdminAnalyticsResponse = {
  summary: {
    submission_total: number
    high_risk_total: number
    vectorized_source_total: number
    vector_chunk_total: number
  }
  detection_counts: Array<{ label: string; value: number }>
  detection_trend: Array<Record<string, string | number>>
  risk_level_counts: Array<{ label: string; value: number }>
  fraud_type_counts: Array<{ label: string; value: number }>
  feedback_summary: {
    total: number
    fraud_total: number
    safe_total: number
    helpful_total: number
  }
  feedback_trend: Array<{ day: string; 总数: number; 有效: number }>
  feedback_correction_counts: Array<{ label: string; value: number }>
  rag_overview: {
    embedding_model: string
    source_total: number
    vectorized_source_total: number
    chunk_total: number
    completed_total: number
    empty_total: number
    failed_total: number
    pending_total: number
    latest_synced_at?: string | null
  }
  rag_status_counts: Array<{ label: string; value: number }>
  rag_sync_trend: Array<Record<string, string | number>>
}

export type AdminSourceItem = {
  id: number
  title: string
  summary: string
  data_source?: string | null
  source_type: string
  sample_label: string
  fraud_type?: string | null
  tags: string[]
  task_type: string[]
  content: string
  preview: string
  url?: string | null
  created_at?: string | null
  image_path: string[]
  video_path: string[]
}

export type AdminFeedbackItem = {
  id: string
  user_id: string
  user_display_name?: string | null
  user_phone_masked?: string | null
  submission_id: string
  job_id?: string | null
  result_id?: string | null
  user_label: string
  reviewed_fraud_type?: string | null
  helpful?: boolean | null
  effective_status: string
  correction_type: string
  note?: string | null
  preview: string
  stored_is_fraud?: boolean | null
  stored_risk_level?: string | null
  stored_fraud_type?: string | null
  created_at: string
  updated_at: string
  job_status?: string | null
}

type RequestOptions = Omit<RequestInit, "body"> & {
  token?: string | null
  body?: BodyInit | Record<string, unknown> | null
}

async function parsePayload(response: Response) {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function getErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object") {
    const detail = (payload as { detail?: unknown }).detail
    if (typeof detail === "string" && detail.trim()) return detail
    if (Array.isArray(detail) && detail.length) {
      const first = detail[0]
      if (typeof first === "string") return first
      if (first && typeof first === "object" && "msg" in first && typeof first.msg === "string") {
        return first.msg
      }
    }
    if ("message" in payload && typeof (payload as { message?: unknown }).message === "string") {
      return (payload as { message: string }).message
    }
  }
  if (typeof payload === "string" && payload.trim()) return payload
  return fallback
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { token, body, headers, ...rest } = options
  const requestHeaders = new Headers(headers)

  let requestBody: BodyInit | undefined
  if (body instanceof FormData) {
    requestBody = body
  } else if (body != null) {
    requestHeaders.set("Content-Type", "application/json")
    requestBody = JSON.stringify(body)
  }

  if (token) {
    requestHeaders.set("Authorization", `Bearer ${token}`)
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...rest,
    body: requestBody,
    headers: requestHeaders,
    cache: "no-store",
  })

  const payload = await parsePayload(response)
  if (!response.ok) {
    throw new AdminApiError(response.status, getErrorMessage(payload, `请求失败（${response.status}）`))
  }
  return payload as T
}

export function createAdminSessionPayload(data: AdminLoginResponse) {
  return {
    accessToken: data.access_token,
    user: data.user,
  }
}

export async function loginAdmin(phone: string, password: string) {
  const data = await request<AdminLoginResponse>("/api/auth/login", {
    method: "POST",
    body: { phone, password },
  })
  if (!data.user.is_admin) {
    throw new AdminApiError(403, "需要管理员权限")
  }
  return data
}

export async function fetchCurrentUser(token: string) {
  const data = await request<AdminUser>("/api/me", { token })
  if (!data.is_admin) {
    throw new AdminApiError(403, "需要管理员权限")
  }
  return data
}

export function fetchAdminDashboard(token: string) {
  return request<AdminDashboardResponse>("/api/admin/dashboard", { token })
}

export function fetchAdminAnalytics(token: string) {
  return request<AdminAnalyticsResponse>("/api/admin/analytics/overview", { token })
}

export async function fetchAdminCases(token: string, params?: { reviewStatus?: string; search?: string; limit?: number }) {
  const searchParams = new URLSearchParams()
  if (params?.reviewStatus && params.reviewStatus !== "all") searchParams.set("review_status", params.reviewStatus)
  if (params?.search) searchParams.set("search", params.search)
  searchParams.set("limit", String(params?.limit ?? 120))
  const query = searchParams.toString()
  return request<{ items: AdminCaseItem[] }>(`/api/admin/cases${query ? `?${query}` : ""}`, { token })
}

export function reviewAdminCase(token: string, caseId: string, action: "approve" | "reject", note?: string) {
  return request<{ item: AdminCaseItem }>(`/api/admin/cases/${caseId}/review`, {
    method: "POST",
    token,
    body: {
      action,
      note: note?.trim() || null,
    },
  })
}

export function approveAllAdminCases(token: string, note?: string) {
  return request<{
    total: number
    approved_count: number
    failed_count: number
    failed_cases: Array<{ id: string; error: string }>
  }>("/api/admin/cases/review-all", {
    method: "POST",
    token,
    body: {
      note: note?.trim() || null,
    },
  })
}

export function syncAdminCases(token: string, urls?: string[]) {
  return request<{
    sync_run?: AdminDashboardResponse["latest_case_sync"]
    discovered_count: number
    inserted_count: number
    updated_count: number
    skipped_count: number
    operator: string
  }>("/api/admin/cases/sync", {
    method: "POST",
    token,
    body: urls?.length ? { urls } : {},
  })
}

export async function fetchKnowledgeSources(
  token: string,
  params?: { search?: string; sampleLabel?: string; limit?: number },
) {
  const searchParams = new URLSearchParams()
  if (params?.search) searchParams.set("search", params.search)
  if (params?.sampleLabel && params.sampleLabel !== "all") searchParams.set("sample_label", params.sampleLabel)
  searchParams.set("limit", String(params?.limit ?? 120))
  const query = searchParams.toString()
  return request<{ items: AdminSourceItem[] }>(`/api/admin/library/sources${query ? `?${query}` : ""}`, { token })
}

export function importKnowledgeText(
  token: string,
  body: {
    title?: string | null
    content: string
    sample_label?: "black" | "white"
    fraud_type?: string | null
    url?: string | null
    data_source?: string | null
  },
) {
  return request<{ item: AdminSourceItem; rag_job_ids: string[] }>("/api/admin/library/sources/import-text", {
    method: "POST",
    token,
    body,
  })
}

export function importKnowledgeFile(
  token: string,
  payload: {
    file: File
    title?: string
    sampleLabel?: "black" | "white"
    fraudType?: string
    url?: string
    dataSource?: string
  },
) {
  const formData = new FormData()
  formData.set("file", payload.file)
  if (payload.title?.trim()) formData.set("title", payload.title.trim())
  formData.set("sample_label", payload.sampleLabel ?? "white")
  if (payload.fraudType?.trim()) formData.set("fraud_type", payload.fraudType.trim())
  if (payload.url?.trim()) formData.set("url", payload.url.trim())
  if (payload.dataSource?.trim()) formData.set("data_source", payload.dataSource.trim())

  return request<{ item: AdminSourceItem; rag_job_ids: string[] }>("/api/admin/library/sources/import-file", {
    method: "POST",
    token,
    body: formData,
  })
}

export function deleteKnowledgeSource(token: string, sourceId: number) {
  return request<{ ok: boolean }>(`/api/admin/library/sources/${sourceId}`, {
    method: "DELETE",
    token,
  })
}

export async function fetchAdminFeedback(token: string, limit = 120) {
  return request<{ items: AdminFeedbackItem[] }>(`/api/admin/feedback?limit=${limit}`, { token })
}
