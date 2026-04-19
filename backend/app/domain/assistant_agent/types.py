from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class CapabilitySpec:
    key: str
    label: str
    aliases: tuple[str, ...]
    modalities: tuple[str, ...]
    submit_text: str


CAPABILITY_SPECS: tuple[CapabilitySpec, ...] = (
    CapabilitySpec(
        key="analysis",
        label="综合分析",
        aliases=("综合", "综合分析", "全部分析", "全检测", "总分析", "图片检测", "图像检测"),
        modalities=("text", "image", "audio", "video"),
        submit_text="请对当前材料做综合分析",
    ),
    CapabilitySpec(
        key="text_detection",
        label="文本检测",
        aliases=("文本检测", "文本分析", "文字检测", "话术检测", "诈骗话术"),
        modalities=("text",),
        submit_text="请执行文本检测",
    ),
    CapabilitySpec(
        key="ocr",
        label="OCR话术识别",
        aliases=("ocr", "ocr识别", "ocr检测", "文字识别", "话术识别"),
        modalities=("image",),
        submit_text="请执行 OCR 话术识别",
    ),
    CapabilitySpec(
        key="official_document",
        label="公章仿造",
        aliases=("公章", "公章仿造", "公文", "公文检测", "公文仿造", "公章检测"),
        modalities=("image",),
        submit_text="请执行公章仿造检测",
    ),
    CapabilitySpec(
        key="pii",
        label="敏感信息检测",
        aliases=("敏感信息", "隐私", "pii", "身份证", "银行卡", "验证码"),
        modalities=("text", "image"),
        submit_text="请执行敏感信息检测",
    ),
    CapabilitySpec(
        key="qr",
        label="二维码URL检测",
        aliases=("二维码", "qr", "扫码", "二维码url", "二维码检测"),
        modalities=("image",),
        submit_text="请执行二维码 URL 检测",
    ),
    CapabilitySpec(
        key="impersonation",
        label="网图识别",
        aliases=("网图", "网图识别", "搜图", "以图识图", "盗图", "反向搜图", "reverse image"),
        modalities=("image",),
        submit_text="请执行网图识别",
    ),
    CapabilitySpec(
        key="web_phishing",
        label="网址钓鱼检测",
        aliases=("网址", "网址钓鱼", "链接", "url", "域名", "网页钓鱼", "网站钓鱼"),
        modalities=("text",),
        submit_text="请执行网址钓鱼检测",
    ),
    CapabilitySpec(
        key="audio_scam_insight",
        label="语音深度分析",
        aliases=(
            "语音深度分析",
            "语音分析",
            "音频分析",
            "过程演化",
            "阶段轨迹",
            "关键证据",
            "雷达图",
            "语音诈骗分析",
            "通话分析",
        ),
        modalities=("audio",),
        submit_text="请执行语音深度分析",
    ),
    CapabilitySpec(
        key="audio_verify",
        label="AI音频鉴别",
        aliases=("音频", "录音", "声音", "语音", "ai音频", "ai声音", "变声"),
        modalities=("audio",),
        submit_text="请执行 AI 音频鉴别",
    ),
    CapabilitySpec(
        key="ai_face",
        label="AI换脸检测",
        aliases=("换脸", "ai换脸", "deepfake", "伪造人脸"),
        modalities=("image",),
        submit_text="请执行 AI 换脸检测",
    ),
)

CAPABILITY_MAP = {item.key: item for item in CAPABILITY_SPECS}
CAPABILITY_ORDER = tuple(item.key for item in CAPABILITY_SPECS)
CAPABILITY_ALIAS_MAP = {
    alias.lower(): item.key for item in CAPABILITY_SPECS for alias in item.aliases
}

IMAGE_CLARIFY_ORDER = (
    "impersonation",
    "ocr",
    "qr",
    "official_document",
    "pii",
    "ai_face",
    "analysis",
)
TEXT_CLARIFY_ORDER = (
    "text_detection",
    "web_phishing",
    "pii",
    "analysis",
)
AUDIO_CLARIFY_ORDER = (
    "audio_scam_insight",
    "audio_verify",
    "analysis",
)


def get_capability(key: str) -> CapabilitySpec | None:
    return CAPABILITY_MAP.get(key)


def available_capabilities_for_modalities(modalities: set[str]) -> list[str]:
    matched: list[str] = []
    for key in CAPABILITY_ORDER:
        spec = CAPABILITY_MAP[key]
        if any(modality in modalities for modality in spec.modalities):
            matched.append(key)
    return matched


def expand_capability_aliases(normalized_text: str, modalities: set[str]) -> list[str]:
    if not normalized_text:
        return []

    selected: list[str] = []
    collapsed = normalized_text.lower().replace(" ", "")
    wants_all = any(
        token in collapsed
        for token in ("全部", "都执行", "全跑", "全做", "都做", "一起跑", "串行跑", "全检测")
    )
    if wants_all:
        return available_capabilities_for_modalities(modalities)

    for alias, key in CAPABILITY_ALIAS_MAP.items():
        compact_alias = alias.replace(" ", "")
        if compact_alias and compact_alias in collapsed and key not in selected:
            selected.append(key)

    if "http://" in collapsed or "https://" in collapsed:
        if "web_phishing" not in selected:
            selected.append("web_phishing")

    if ("图片" in collapsed or "图像" in collapsed) and any(item in modalities for item in {"image", "video"}):
        if not selected:
            selected.append("analysis")

    return [key for key in CAPABILITY_ORDER if key in selected]


def build_clarify_options(modalities: set[str]) -> list[dict[str, str]]:
    options: list[dict[str, str]] = []
    order: tuple[str, ...] = ()
    if "image" in modalities:
        order = IMAGE_CLARIFY_ORDER
    elif "audio" in modalities:
        order = AUDIO_CLARIFY_ORDER
    elif "text" in modalities:
        order = TEXT_CLARIFY_ORDER

    for key in order:
        spec = get_capability(key)
        if spec is None:
            continue
        options.append(
            {
                "key": spec.key,
                "label": spec.label,
                "submit_text": spec.submit_text,
            }
        )

    if options:
        options.append(
            {
                "key": "all",
                "label": "全部执行",
                "submit_text": "请把当前材料支持的功能都串行执行",
            }
        )
    return options
