type Handler = () => void;

let handler: Handler | null = null;

export function setAssistantFreshChatHandler(next: Handler | null) {
  handler = next;
}

/** 已在智能体 Tab 时再次点击底栏「智能体」时触发 */
export function requestFreshAssistantChatFromTab() {
  handler?.();
}
