import type {
  DetectionGraphEdge,
  DetectionGraphNode,
  DetectionJob,
  DetectionModuleTraceItem,
  DetectionPipelineProgressDetail,
  DetectionResult,
  DetectionResultDetail,
  DetectionReasoningGraph,
  KnownDetectionPipelineStep,
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toStrength(value: unknown, fallback = 0.5) {
  return Math.max(0, Math.min(1, toNumber(value, fallback)));
}

function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => String(item)).filter(Boolean);
}

export const pipelineStepOrder: KnownDetectionPipelineStep[] = [
  "queued",
  "preprocess",
  "embedding",
  "vector_retrieval",
  "graph_reasoning",
  "llm_reasoning",
  "finalize",
];

export const pipelineDisplaySteps: KnownDetectionPipelineStep[] = [
  "preprocess",
  "embedding",
  "vector_retrieval",
  "graph_reasoning",
  "llm_reasoning",
  "finalize",
];

export const pipelineStepMeta: Record<
  KnownDetectionPipelineStep,
  {
    label: string;
    shortLabel: string;
    icon: string;
    accent: string;
    soft: string;
  }
> = {
  queued: {
    label: "排队中",
    shortLabel: "排队",
    icon: "timer-sand",
    accent: "#2F70E6",
    soft: "#EAF2FF",
  },
  preprocess: {
    label: "文本清洗",
    shortLabel: "清洗",
    icon: "text-box-search-outline",
    accent: "#2F70E6",
    soft: "#EAF2FF",
  },
  embedding: {
    label: "向量编码",
    shortLabel: "编码",
    icon: "blur-linear",
    accent: "#1F8CFF",
    soft: "#E8F5FF",
  },
  vector_retrieval: {
    label: "向量召回",
    shortLabel: "召回",
    icon: "vector-link",
    accent: "#6A78F5",
    soft: "#EEF0FF",
  },
  graph_reasoning: {
    label: "图谱推理",
    shortLabel: "图谱",
    icon: "graph-outline",
    accent: "#E38A57",
    soft: "#FFF2EA",
  },
  llm_reasoning: {
    label: "模型判别",
    shortLabel: "判别",
    icon: "brain",
    accent: "#7E67F4",
    soft: "#F1ECFF",
  },
  finalize: {
    label: "结果收束",
    shortLabel: "完成",
    icon: "shield-check-outline",
    accent: "#2E9D7F",
    soft: "#E9FAF4",
  },
};

const signalLabelMap: Record<string, string> = {
  credential_request: "索要验证码",
  transfer_request: "要求转账",
  urgency_pressure: "紧急施压",
  impersonation: "身份冒充",
  download_redirect: "下载跳转",
  privacy_request: "索要敏感信息",
  remote_control: "远程控制",
  part_time_bait: "刷单兼职",
  investment_bait: "投资理财诱导",
  after_sale_pretext: "退款售后诱导",
  secrecy_isolation: "要求保密",
  anti_fraud_context: "反诈提醒",
  negation_safety: "明确劝阻风险操作",
  official_verification_guidance: "建议官方核验",
  entity_risk: "高风险实体",
  action_density: "操作密度高",
  "索要验证码": "索要验证码",
  "要求转账付款": "要求转账",
  "制造紧急压力": "紧急施压",
  "身份冒充": "冒充身份",
  "引导下载或点击链接": "下载跳转",
  "索要敏感信息": "敏感信息",
  "远程控制或共享屏幕": "远程控制",
  "刷单返利 / 兼职诱导": "刷单兼职",
  "投资理财诱导": "投资诱导",
  "退款售后诱导": "退款售后",
  "要求保密": "要求保密",
};

const graphNodeFallbackMap: Record<string, string> = {
  input: "原文",
  guard: "降险依据",
  "evidence:black": "接近风险案例",
  "evidence:white": "接近正常说明",
  fraud_type: "类型",
  risk_level: "结论",
  lack_text: "缺少文本",
  manual_review: "人工复核",
};

function isBrokenLabel(value: unknown): boolean {
  const label = String(value ?? "").trim();
  if (!label) {
    return true;
  }
  if (/^\?+$/.test(label)) {
    return true;
  }
  if (/^[A-Za-z_]+$/.test(label)) {
    return true;
  }
  return false;
}

function sanitizeSignalLabel(value: string): string {
  const normalized = value.trim();
  return signalLabelMap[normalized] ?? normalized;
}

function sanitizePipelineLabel(key: string, label: unknown): string {
  const raw = String(label ?? "").trim();
  if (!isBrokenLabel(raw)) {
    return raw;
  }
  const step = key as KnownDetectionPipelineStep;
  if (step in pipelineStepMeta) {
    return pipelineStepMeta[step].shortLabel;
  }
  return raw || key;
}

function sanitizeNodeLabel(nodeId: string, label: unknown): string {
  const raw = String(label ?? "").trim();
  if (!isBrokenLabel(raw)) {
    return sanitizeSignalLabel(raw);
  }
  return (signalLabelMap[raw] ?? signalLabelMap[nodeId] ?? graphNodeFallbackMap[raw] ?? graphNodeFallbackMap[nodeId] ?? raw) || "节点";
}

export function normalizeDetectionStep(
  step?: string | null,
  status?: string | null,
): KnownDetectionPipelineStep {
  const normalized = String(step ?? "").trim().toLowerCase();
  if (normalized in pipelineStepMeta) {
    return normalized as KnownDetectionPipelineStep;
  }
  if (status === "completed") {
    return "finalize";
  }
  if (status === "failed") {
    return "finalize";
  }
  if (status === "running") {
    return "preprocess";
  }
  return "queued";
}

export function getResultDetail(result?: DetectionResult | null): DetectionResultDetail | null {
  if (!result || !isRecord(result.result_detail)) {
    return null;
  }
  return result.result_detail as DetectionResultDetail;
}

export function getProgressDetail(job?: DetectionJob | null): DetectionPipelineProgressDetail | null {
  if (!job || !isRecord(job.progress_detail)) {
    return null;
  }
  return job.progress_detail as DetectionPipelineProgressDetail;
}

function normalizeModuleTraceItems(items: unknown): DetectionModuleTraceItem[] {
  if (!Array.isArray(items)) {
    return [];
  }
  return items
    .filter(isRecord)
    .map((item, index) => {
      const action = String(item.action ?? item.key ?? "").trim();
      const key = String(item.key ?? action).trim();
      const id = String(item.id ?? "").trim() || `${key || "step"}-${index + 1}`;
      const iterationValue = item.iteration;
      const iteration =
        typeof iterationValue === "number" && Number.isFinite(iterationValue)
          ? iterationValue
          : Number.isFinite(Number(iterationValue))
            ? Number(iterationValue)
            : undefined;
      return {
        ...item,
        id,
        key,
        action: action || key,
        label: sanitizePipelineLabel(key, item.label ?? item.key ?? ""),
        status: String(item.status ?? "pending"),
        enabled: item.enabled !== false,
        iteration,
        metrics: isRecord(item.metrics)
          ? (item.metrics as Record<string, number | string | null>)
          : undefined,
      };
    })
    .filter((item) => Boolean(item.key));
}

export function buildDetectionModuleTrace(
  job?: DetectionJob | null,
  result?: DetectionResult | null,
): DetectionModuleTraceItem[] {
  const progressDetail = getProgressDetail(job);
  const resultDetail = getResultDetail(result);
  const detailItems = normalizeModuleTraceItems(
    progressDetail?.execution_trace
      ?? resultDetail?.execution_trace
      ?? progressDetail?.module_trace
      ?? resultDetail?.module_trace,
  );
  if (detailItems.length) {
    return detailItems;
  }

  const activeStep = normalizeDetectionStep(job?.current_step ?? undefined, job?.status ?? undefined);
  const activeIndex = pipelineDisplaySteps.findIndex((item) => item === activeStep);
  const isCompleted = job?.status === "completed" || Boolean(result);
  const isFailed = job?.status === "failed";

  return pipelineDisplaySteps.map((step, index) => {
    let status = "pending";
    if (isCompleted) {
      status = "completed";
    } else if (isFailed) {
      if (index < Math.max(activeIndex, 0)) {
        status = "completed";
      } else if (index === Math.max(activeIndex, 0)) {
        status = "failed";
      }
    } else if (activeIndex >= 0) {
      if (index < activeIndex) {
        status = "completed";
      } else if (index === activeIndex) {
        status = "running";
      }
    }

    return {
      id: `pipeline-${step}-${index + 1}`,
      key: step,
      action: step,
      label: pipelineStepMeta[step].shortLabel,
      status,
      iteration: index + 1,
      enabled: true,
    };
  });
}

function normalizeNode(node: Record<string, unknown>): DetectionGraphNode {
  const id = String(node.id ?? "");
  return {
    id,
    label: sanitizeNodeLabel(id, node.label ?? node.id ?? "节点"),
    kind: String(node.kind ?? "node"),
    tone: typeof node.tone === "string" ? node.tone : "primary",
    lane: toNumber(node.lane, 0),
    order: toNumber(node.order, 0),
    strength: toStrength(node.strength, 0.6),
    meta: isRecord(node.meta) ? node.meta : {},
    ...node,
  };
}

function normalizeEdge(edge: Record<string, unknown>): DetectionGraphEdge {
  return {
    id: String(edge.id ?? `${String(edge.source ?? "")}:${String(edge.target ?? "")}`),
    source: String(edge.source ?? ""),
    target: String(edge.target ?? ""),
    tone: typeof edge.tone === "string" ? edge.tone : "primary",
    kind: typeof edge.kind === "string" ? edge.kind : "link",
    weight: toStrength(edge.weight, 0.5),
    ...edge,
  };
}

function normalizeGraph(graph: Record<string, unknown>): DetectionReasoningGraph | null {
  const rawNodes = Array.isArray(graph.nodes) ? graph.nodes.filter(isRecord) : [];
  const rawEdges = Array.isArray(graph.edges) ? graph.edges.filter(isRecord) : [];
  const seenNodeIds = new Map<string, number>();
  const nodeIdLookup = new Map<string, string>();
  const nodes = rawNodes
    .map(normalizeNode)
    .filter((item) => Boolean(item.id))
    .map((item) => {
      const count = (seenNodeIds.get(item.id) ?? 0) + 1;
      seenNodeIds.set(item.id, count);
      const resolvedId = count === 1 ? item.id : `${item.id}#${count}`;
      if (!nodeIdLookup.has(item.id)) {
        nodeIdLookup.set(item.id, resolvedId);
      }
      return resolvedId === item.id ? item : { ...item, id: resolvedId };
    });
  const validNodeIds = new Set(nodes.map((item) => item.id));
  const edges = rawEdges
    .map(normalizeEdge)
    .map((item, index) => {
      const source = nodeIdLookup.get(item.source) ?? item.source;
      const target = nodeIdLookup.get(item.target) ?? item.target;
      return {
        ...item,
        id: String(item.id || `${source}:${target}:${index}`),
        source,
        target,
      };
    })
    .filter((item) => Boolean(item.source && item.target))
    .filter((item) => validNodeIds.has(item.source) && validNodeIds.has(item.target));
  if (!nodes.length) {
    return null;
  }
  const labelLookup = new Map(nodes.map((item) => [item.id, item.label]));
  const highlightedPath = getStringArray(graph.highlighted_path)
    .map((item) => nodeIdLookup.get(item) ?? item)
    .filter((item) => validNodeIds.has(item));
  const highlightedLabels = getStringArray(graph.highlighted_labels)
    .map((item) => sanitizeNodeLabel(item, item))
    .filter(Boolean);
  const normalizedHighlightedLabels = highlightedLabels.length
    && highlightedLabels.some((item) => !isBrokenLabel(item))
      ? highlightedLabels
      : highlightedPath.map((item) => labelLookup.get(item) ?? signalLabelMap[item] ?? graphNodeFallbackMap[item] ?? item).filter(Boolean);
  return {
    ...graph,
    nodes,
    edges,
    highlighted_path: highlightedPath,
    highlighted_labels: normalizedHighlightedLabels,
    summary_metrics: isRecord(graph.summary_metrics)
      ? (graph.summary_metrics as Record<string, number | string | null>)
      : undefined,
  };
}

function compactGraphLabel(value: unknown, fallback: string, max = 6): string {
  const raw = sanitizeSignalLabel(String(value ?? "").trim());
  if (!raw || isBrokenLabel(raw)) {
    return fallback;
  }
  if (raw.length <= max) {
    return raw;
  }
  return `${raw.slice(0, max)}…`;
}

function getDetailStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
}

function getRiskGraphMeta(riskLevel: DetectionResult["risk_level"]) {
  if (riskLevel === "high") {
    return { label: "高风险", tone: "danger" as const };
  }
  if (riskLevel === "medium") {
    return { label: "需核验", tone: "warning" as const };
  }
  return { label: "低风险", tone: "safe" as const };
}

export function buildReasoningGraph(result?: DetectionResult | null): DetectionReasoningGraph | null {
  if (!result) {
    return null;
  }

  const resultDetail = getResultDetail(result);
  if (resultDetail?.reasoning_graph && isRecord(resultDetail.reasoning_graph)) {
    const graph = normalizeGraph(resultDetail.reasoning_graph);
    if (graph) {
      return graph;
    }
  }

  const riskMeta = getRiskGraphMeta(result.risk_level);
  const blackCount = result.retrieved_evidence.length;
  const whiteCount = result.counter_evidence.length;
  const riskBasis = getDetailStringArray(resultDetail?.risk_evidence).length
    ? getDetailStringArray(resultDetail?.risk_evidence)
    : (result.hit_rules.length ? result.hit_rules : result.rule_hits.map((item) => item.name))
      .map((item) => compactGraphLabel(item, "风险依据", 8))
      .filter(Boolean)
      .slice(0, 3);
  const counterBasis = getDetailStringArray(resultDetail?.counter_evidence);

  if (blackCount > 0 && !riskBasis.some((item) => item.includes("接近"))) {
    const topFraudType = result.retrieved_evidence[0]?.fraud_type;
    riskBasis.push(compactGraphLabel(topFraudType ? `接近${topFraudType}` : "接近风险案例", "接近风险案例", 8));
  }
  if (whiteCount > 0 && !counterBasis.some((item) => item.includes("接近") || item.includes("更像"))) {
    counterBasis.push("接近正常说明");
  }

  const trimmedRiskBasis = [...new Set(riskBasis)].slice(0, 3);
  const trimmedCounterBasis = [...new Set(counterBasis)].slice(0, 3);

  const nodes: DetectionGraphNode[] = [
    {
      id: "input",
      label: "原文",
      kind: "input",
      tone: "primary",
      lane: 0,
      order: 0,
      strength: 0.76,
      meta: {},
    },
    ...trimmedRiskBasis.map((label, index) => ({
      id: `risk_basis:${index}`,
      label: compactGraphLabel(label, "风险依据", 8),
      kind: "risk_basis",
      tone: "danger",
      lane: 1,
      order: index,
      strength: Math.max(0.44, 0.7 - index * 0.08),
      meta: {},
    })),
    ...trimmedCounterBasis.map((label, index) => ({
      id: `counter_basis:${index}`,
      label: compactGraphLabel(label, "降险依据", 8),
      kind: "counter_basis",
      tone: "safe",
      lane: 2,
      order: index,
      strength: Math.max(0.42, 0.66 - index * 0.08),
      meta: {},
    })),
    {
      id: "risk_level",
      label: riskMeta.label,
      kind: "risk",
      tone: riskMeta.tone,
      lane: 3,
      order: 0,
      strength: Math.max(0.38, result.confidence ?? 0.5),
      meta: {},
    },
  ];

  const edges: DetectionGraphEdge[] = [
    ...trimmedRiskBasis.flatMap((_, index) => ([
      {
        id: `edge:input:risk:${index}`,
        source: "input",
        target: `risk_basis:${index}`,
        tone: "danger",
        kind: "risk_basis",
        weight: Math.max(0.44, 0.66 - index * 0.08),
      },
      {
        id: `edge:risk:result:${index}`,
        source: `risk_basis:${index}`,
        target: "risk_level",
        tone: "danger",
        kind: "decision_support",
        weight: Math.max(0.42, 0.62 - index * 0.08),
      },
    ])),
    ...trimmedCounterBasis.flatMap((_, index) => ([
      {
        id: `edge:input:counter:${index}`,
        source: "input",
        target: `counter_basis:${index}`,
        tone: "safe",
        kind: "counter_basis",
        weight: Math.max(0.4, 0.62 - index * 0.08),
      },
      {
        id: `edge:counter:result:${index}`,
        source: `counter_basis:${index}`,
        target: "risk_level",
        tone: "safe",
        kind: "decision_balance",
        weight: Math.max(0.38, 0.58 - index * 0.08),
      },
    ])),
  ];

  const highlightedPath =
    result.risk_level === "low" && trimmedCounterBasis.length
      ? ["input", "counter_basis:0", "risk_level"]
      : trimmedRiskBasis.length
        ? ["input", "risk_basis:0", "risk_level"]
        : trimmedCounterBasis.length
          ? ["input", "counter_basis:0", "risk_level"]
          : ["input", "risk_level"];

  return {
    nodes,
    edges,
    highlighted_path: highlightedPath,
    highlighted_labels: highlightedPath
      .map((id) => nodes.find((item) => item.id === id)?.label)
      .filter((item): item is string => Boolean(item)),
    lane_labels: ["原文", "可疑", "降险", "结论"],
    summary_metrics: {
      risk_basis_count: trimmedRiskBasis.length,
      counter_basis_count: trimmedCounterBasis.length,
      black_count: blackCount,
      white_count: whiteCount,
      final_score: toNumber(resultDetail?.final_score, result.confidence ? Math.round(result.confidence * 100) : 0),
      confidence: result.confidence,
    },
  };
}
