import type { CallSession } from "./types";

const GENERIC_SUMMARY_PATTERNS = [
  "共命中",
  "已保存录音与风险结果",
  "已保存录音与风险评估结果",
  "后台来电录音已保存",
];

function splitTranscript(text: string) {
  return text
    .split(/[\n。！？!?；;，,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function trimTitle(text: string, limit = 18) {
  const normalized = text.replace(/\s+/g, "").replace(/^[：:，,。；;\-—]+|[：:，,。；;\-—]+$/g, "");
  if (!normalized) {
    return "";
  }
  return normalized.length > limit ? normalized.slice(0, limit) : normalized;
}

export function formatCallPhoneLabel(phoneNumber?: string | null) {
  const normalized = String(phoneNumber ?? "").trim();
  if (!normalized || normalized === "manual_unknown") {
    return "未知号码";
  }
  return normalized;
}

function isGenericSummary(summary?: string | null) {
  const normalized = String(summary ?? "").trim();
  if (!normalized) {
    return true;
  }
  return GENERIC_SUMMARY_PATTERNS.some((pattern) => normalized.includes(pattern));
}

export function deriveCallSessionTitle(session: Pick<CallSession, "summary" | "transcript_full_text" | "phone_number" | "risk_level_final">) {
  const summary = String(session.summary ?? "").trim();
  if (summary && !isGenericSummary(summary)) {
    return trimTitle(summary);
  }

  const transcript = String(session.transcript_full_text ?? "").trim();
  for (const sentence of splitTranscript(transcript)) {
    const title = trimTitle(sentence);
    if (title.length >= 6) {
      return title;
    }
  }

  const phoneLabel = formatCallPhoneLabel(session.phone_number);
  if (session.risk_level_final === "high") {
    return `${phoneLabel}高风险通话`;
  }
  if (session.risk_level_final === "medium") {
    return `${phoneLabel}可疑通话`;
  }
  return `${phoneLabel}通话录音`;
}
