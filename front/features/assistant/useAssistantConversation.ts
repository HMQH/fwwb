import { useCallback, useEffect, useRef, useState } from "react";
import { Keyboard } from "react-native";

import { relationsApi } from "@/features/relations/api";
import type { RelationProfileSummary } from "@/features/relations/types";
import { ApiError } from "@/shared/api";

import { assistantApi } from "./api";
import type {
  AssistantContextBudget,
  AssistantDraftAttachment,
  AssistantExecution,
  AssistantExecutionPlanItem,
  AssistantExecutionStep,
  AssistantMessage,
  AssistantSession,
} from "./types";
import { getAssistantContextBudget } from "./types";

function nowIso() {
  return new Date().toISOString();
}

function sortSessions(items: AssistantSession[]) {
  return [...items].sort((a, b) => {
    const aTime = new Date(a.updated_at).getTime();
    const bTime = new Date(b.updated_at).getTime();
    return bTime - aTime;
  });
}

function upsertSession(list: AssistantSession[], session: AssistantSession) {
  const next = list.filter((item) => item.id !== session.id);
  next.unshift(session);
  return sortSessions(next);
}

function toOptimisticAttachments(attachments: AssistantDraftAttachment[]) {
  return attachments.map((item) => ({
    upload_type: item.kind,
    file_path: "",
    name: item.name,
    mime_type: item.type,
    preview_text: null,
    uri: item.uri,
  }));
}

function makeTempMessage(
  role: "user" | "assistant",
  content: string,
  attachments: AssistantDraftAttachment[] = []
): AssistantMessage {
  return {
    id: `temp-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    session_id: "pending",
    user_id: "pending",
    role,
    content,
    extra_payload: role === "user" && attachments.length ? { attachments: toOptimisticAttachments(attachments) } : {},
    created_at: nowIso(),
    client_status: role === "assistant" ? "pending" : undefined,
  };
}

function getApiErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return String(error.message || fallback);
  }
  return fallback;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function patchMessagePayload(
  messages: AssistantMessage[],
  messageId: string,
  updater: (message: AssistantMessage) => AssistantMessage
) {
  return messages.map((item) => (item.id === messageId ? updater(item) : item));
}

function nextPlanStatus(plan: AssistantExecutionPlanItem[], step: AssistantExecutionStep) {
  return plan.map((item) =>
    item.key === step.capability_key
      ? { ...item, status: step.status }
      : item
  );
}

function upsertStep(steps: AssistantExecutionStep[], incoming: AssistantExecutionStep) {
  const index = steps.findIndex((item) => item.id === incoming.id);
  if (index < 0) {
    return [...steps, incoming];
  }
  const next = [...steps];
  next[index] = incoming;
  return next;
}

function mergeAssistantExecution(
  message: AssistantMessage,
  updater: (execution: AssistantExecution) => AssistantExecution
) {
  const extraPayload = { ...message.extra_payload };
  const currentExecution = isObject(extraPayload.assistant_agent)
    ? (extraPayload.assistant_agent as AssistantExecution)
    : {};
  extraPayload.assistant_agent = updater({ ...currentExecution });
  return { ...message, extra_payload: extraPayload };
}

function applyContextBudget(message: AssistantMessage, budget: AssistantContextBudget) {
  return {
    ...message,
    extra_payload: {
      ...message.extra_payload,
      context_budget: budget,
    },
  };
}

function findLatestContextBudget(messages: AssistantMessage[]): AssistantContextBudget | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const budget = getAssistantContextBudget(messages[index]);
    if (budget) {
      return budget;
    }
  }
  return null;
}

type UseAssistantConversationResult = {
  session: AssistantSession | null;
  sessions: AssistantSession[];
  relations: RelationProfileSummary[];
  selectedRelationId: string | null;
  messages: AssistantMessage[];
  latestContextBudget: AssistantContextBudget | null;
  loading: boolean;
  sending: boolean;
  error: string | null;
  bootstrap: () => Promise<void>;
  openSession: (sessionId: string) => Promise<void>;
  createNewSession: (relationProfileId?: string | null) => Promise<void>;
  /** 空白新会话（不保留关联对象），用于底栏进入智能体 */
  resetToBlankChat: () => Promise<void>;
  selectRelation: (relationProfileId: string | null) => Promise<void>;
  sendMessage: (content: string, attachments?: AssistantDraftAttachment[]) => Promise<boolean>;
  sendQuickAction: (content: string) => Promise<boolean>;
};

export function useAssistantConversation(token?: string | null): UseAssistantConversationResult {
  const aliveRef = useRef(true);
  const [session, setSession] = useState<AssistantSession | null>(null);
  const [sessions, setSessions] = useState<AssistantSession[]>([]);
  const [relations, setRelations] = useState<RelationProfileSummary[]>([]);
  const [selectedRelationId, setSelectedRelationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [latestContextBudget, setLatestContextBudget] = useState<AssistantContextBudget | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const applyDraftState = useCallback((relationProfileId?: string | null) => {
    setSession(null);
    setMessages([]);
    setLatestContextBudget(null);
    setSelectedRelationId(relationProfileId ?? null);
    setError(null);
    setLoading(false);
    setSending(false);
  }, []);

  const openSession = useCallback(
    async (sessionId: string) => {
      if (!token) {
        return;
      }

      setLoading(true);
      setError(null);
      setLatestContextBudget(null);
      setMessages([]);
      try {
        const detail = await assistantApi.getSession(token, sessionId);
        if (!aliveRef.current) {
          return;
        }
        setSession(detail.session);
        setMessages(detail.messages);
        setLatestContextBudget(findLatestContextBudget(detail.messages));
        setSessions((prev) => upsertSession(prev, detail.session));
      } catch (err) {
        if (!aliveRef.current) {
          return;
        }
        setError(getApiErrorMessage(err, "加载会话失败"));
      } finally {
        if (aliveRef.current) {
          setLoading(false);
        }
      }
    },
    [token]
  );

  const createNewSession = useCallback(
    async (relationProfileId?: string | null) => {
      applyDraftState(relationProfileId ?? selectedRelationId ?? null);
    },
    [applyDraftState, selectedRelationId]
  );

  const resetToBlankChat = useCallback(async () => {
    applyDraftState(null);
  }, [applyDraftState]);

  const bootstrap = useCallback(async () => {
    if (!token) {
      if (!aliveRef.current) {
        return;
      }
      setSession(null);
      setSessions([]);
      setRelations([]);
      setMessages([]);
      setLatestContextBudget(null);
      setSelectedRelationId(null);
      setLoading(false);
      setSending(false);
      return;
    }

    setLoading(true);
    setSending(false);
    setError(null);

    try {
      const [sessionsResult, relationsResult] = await Promise.allSettled([
        assistantApi.listSessions(token, 24),
        relationsApi.list(token),
      ]);

      const initialSessions = sessionsResult.status === "fulfilled" ? sessionsResult.value : [];
      const initialRelations = relationsResult.status === "fulfilled" ? relationsResult.value : [];

      if (!aliveRef.current) {
        return;
      }

      setRelations(initialRelations);
      setSessions(sortSessions(initialSessions));

      // 主界面始终进入新对话草稿；历史会话从抽屉打开，避免底栏进入仍停留在旧对话
      applyDraftState(null);
    } catch (err) {
      if (!aliveRef.current) {
        return;
      }
      setError(getApiErrorMessage(err, "加载助手失败"));
      setLoading(false);
    } finally {
      if (aliveRef.current) {
        setLoading(false);
      }
    }
  }, [applyDraftState, token]);

  const selectRelation = useCallback(
    async (relationProfileId: string | null) => {
      if (!token || sending || loading) {
        return;
      }
      setError(null);
      setSelectedRelationId(relationProfileId);
    },
    [loading, sending, token]
  );

  const sendMessage = useCallback(
    async (content: string, attachments: AssistantDraftAttachment[] = []) => {
      const normalized = content.trim();
      if (!token || loading || sending || (!normalized && attachments.length === 0)) {
        return false;
      }

      Keyboard.dismiss();
      setError(null);
      setSending(true);

      const optimisticUser = makeTempMessage("user", normalized, attachments);
      const optimisticAssistant = makeTempMessage("assistant", "");
      setMessages((prev) => [...prev, optimisticUser, optimisticAssistant]);

      try {
        let workingSession = session;

        if (!workingSession) {
          const created = await assistantApi.createSession(token);
          if (!aliveRef.current) {
            return false;
          }
          workingSession = created.session;
          setSession(created.session);
          setSessions((prev) => upsertSession(prev, created.session));
          setMessages((prev) => {
            const existingIds = new Set(prev.map((item) => item.id));
            const prefix = created.messages.filter((item) => !existingIds.has(item.id));
            return prefix.length ? [...prefix, ...prev] : prev;
          });
        }

        await assistantApi.streamMessage(
          token,
          workingSession.id,
          {
            content: normalized,
            attachments,
            relationProfileId: selectedRelationId,
          },
          {
            onAck: (payload) => {
              if (!aliveRef.current) {
                return;
              }
              setSession(payload.session);
              setSessions((prev) => upsertSession(prev, payload.session));
              setMessages((prev) =>
                prev.map((item) => {
                  if (item.id === optimisticUser.id) {
                    return payload.user_message;
                  }
                  if (item.id === optimisticAssistant.id) {
                    return {
                      ...payload.assistant_message,
                      content: "",
                      client_status: "pending",
                    };
                  }
                  return item;
                })
              );
            },
            onContextBudget: (payload) => {
              if (!aliveRef.current) {
                return;
              }
              setLatestContextBudget(payload.budget);
              setMessages((prev) =>
                patchMessagePayload(prev, payload.assistant_message_id, (item) => applyContextBudget(item, payload.budget))
              );
            },
            onClarify: (payload) => {
              if (!aliveRef.current) {
                return;
              }
              setMessages((prev) =>
                patchMessagePayload(prev, payload.assistant_message_id, (item) =>
                  mergeAssistantExecution(item, (execution) => ({
                    ...execution,
                    mode: "clarify",
                    clarify: payload.clarify,
                  }))
                )
              );
            },
            onPlan: (payload) => {
              if (!aliveRef.current) {
                return;
              }
              setMessages((prev) =>
                patchMessagePayload(prev, payload.assistant_message_id, (item) =>
                  mergeAssistantExecution(item, (execution) => ({
                    ...execution,
                    plan: payload.items,
                  }))
                )
              );
            },
            onStepStart: (payload) => {
              if (!aliveRef.current) {
                return;
              }
              setMessages((prev) =>
                patchMessagePayload(prev, payload.assistant_message_id, (item) =>
                  mergeAssistantExecution(item, (execution) => {
                    const steps = upsertStep(execution.steps ?? [], payload.step);
                    return {
                      ...execution,
                      steps,
                      plan: execution.plan ? nextPlanStatus(execution.plan, payload.step) : execution.plan,
                    };
                  })
                )
              );
            },
            onStepUpdate: (payload) => {
              if (!aliveRef.current) {
                return;
              }
              setMessages((prev) =>
                patchMessagePayload(prev, payload.assistant_message_id, (item) =>
                  mergeAssistantExecution(item, (execution) => ({
                    ...execution,
                    steps: upsertStep(execution.steps ?? [], payload.step),
                    plan: execution.plan ? nextPlanStatus(execution.plan, payload.step) : execution.plan,
                  }))
                )
              );
            },
            onStepDone: (payload) => {
              if (!aliveRef.current) {
                return;
              }
              setMessages((prev) =>
                patchMessagePayload(prev, payload.assistant_message_id, (item) =>
                  mergeAssistantExecution(item, (execution) => ({
                    ...execution,
                    steps: upsertStep(execution.steps ?? [], payload.step),
                    plan: execution.plan ? nextPlanStatus(execution.plan, payload.step) : execution.plan,
                  }))
                )
              );
            },
            onStepError: (payload) => {
              if (!aliveRef.current) {
                return;
              }
              setMessages((prev) =>
                patchMessagePayload(prev, payload.assistant_message_id, (item) =>
                  mergeAssistantExecution(item, (execution) => ({
                    ...execution,
                    steps: upsertStep(execution.steps ?? [], payload.step),
                    plan: execution.plan ? nextPlanStatus(execution.plan, payload.step) : execution.plan,
                  }))
                )
              );
            },
            onDelta: (payload) => {
              if (!aliveRef.current) {
                return;
              }
              setMessages((prev) =>
                patchMessagePayload(prev, payload.assistant_message_id, (item) => ({
                  ...item,
                  content: item.content + payload.delta,
                  client_status: "streaming",
                }))
              );
            },
            onDone: (payload) => {
              if (!aliveRef.current) {
                return;
              }
              setSession(payload.session);
              setSessions((prev) => upsertSession(prev, payload.session));
              setLatestContextBudget(getAssistantContextBudget(payload.assistant_message));
              setMessages((prev) =>
                prev.map((item) =>
                  item.id === payload.assistant_message.id
                    ? { ...payload.assistant_message, client_status: undefined }
                    : item
                )
              );
            },
            onError: (message) => {
              if (!aliveRef.current) {
                return;
              }
              setError(message);
            },
          }
        );

        return true;
      } catch (err) {
        if (!aliveRef.current) {
          return false;
        }
        setMessages((prev) =>
          prev.filter((item) => item.id !== optimisticUser.id && item.id !== optimisticAssistant.id)
        );
        setError(getApiErrorMessage(err, "发送失败"));
        return false;
      } finally {
        if (aliveRef.current) {
          setSending(false);
        }
      }
    },
    [loading, selectedRelationId, sending, session, token]
  );

  const sendQuickAction = useCallback(
    async (content: string) => sendMessage(content, []),
    [sendMessage]
  );

  return {
    session,
    sessions,
    relations,
    selectedRelationId,
    messages,
    latestContextBudget,
    loading,
    sending,
    error,
    bootstrap,
    openSession,
    createNewSession,
    resetToBlankChat,
    selectRelation,
    sendMessage,
    sendQuickAction,
  };
}
