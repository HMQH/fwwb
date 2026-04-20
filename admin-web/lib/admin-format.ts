export const REVIEW_STATUS_LABELS: Record<string, string> = {
  pending: "待审核",
  approved: "已通过",
  rejected: "已驳回",
}

export const FEEDBACK_USER_LABELS: Record<string, string> = {
  fraud: "诈骗",
  safe: "安全",
  unknown: "待定",
}

export const SAMPLE_LABELS: Record<string, string> = {
  black: "黑样本",
  white: "白样本",
}

export function formatFullDateTime(value?: string | null) {
  if (!value) return "--"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "--"
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date)
}

export function formatDate(value?: string | null) {
  if (!value) return "--"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "--"
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date)
}

export function formatRelativeTime(value?: string | null) {
  if (!value) return "--"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "--"

  const diff = date.getTime() - Date.now()
  const abs = Math.abs(diff)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour

  if (abs < minute) return "刚刚"
  if (abs < hour) return `${Math.round(abs / minute)} 分钟${diff <= 0 ? "前" : "后"}`
  if (abs < day) return `${Math.round(abs / hour)} 小时${diff <= 0 ? "前" : "后"}`
  return `${Math.round(abs / day)} 天${diff <= 0 ? "前" : "后"}`
}

export function truncateText(value: string | null | undefined, maxLength: number) {
  const text = String(value || "").trim()
  if (!text) return ""
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text
}

export function splitMultilineInput(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
}
