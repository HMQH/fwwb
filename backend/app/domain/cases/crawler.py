"""官方反诈案例多源抓取与结构化解析。"""
from __future__ import annotations

import hashlib
import html
import logging
import re
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from urllib.parse import urljoin, urlparse

logger = logging.getLogger(__name__)

COURT_SOURCE_NAME = "最高人民法院典型案例"
BEIJING_SOURCE_NAME = "北京市公安局"
GUANGDONG_SOURCE_NAME = "广东省公安厅"
GUANGZHOU_SOURCE_NAME = "广州市公安局"


def _build_index_pages(base_index_url: str, *, page_count: int, next_page_start: int) -> list[str]:
    prefix = base_index_url.rsplit("index.html", 1)[0]
    pages = [base_index_url]
    for offset in range(1, page_count):
        pages.append(f"{prefix}index_{offset + next_page_start - 1}.html")
    return pages


COURT_FIXED_ARTICLE_URLS = [
    "https://www.court.gov.cn/zixun/xiangqing/425102.html",
    "https://www.court.gov.cn/zixun/xiangqing/482861.html",
    "https://www.court.gov.cn/zixun/xiangqing/490051.html",
]
DEFAULT_RELEASE_URLS = COURT_FIXED_ARTICLE_URLS[:]

ANTI_FRAUD_DISCOVERY_KEYWORDS = (
    "诈",
    "诈骗",
    "反诈",
    "防骗",
    "电诈",
    "被骗",
    "劝阻",
    "止付",
    "预警",
    "网购",
    "刷单",
    "客服",
    "理赔",
    "投资",
    "贷款",
    "返利",
    "红包",
    "公检法",
    "帮信",
    "两卡",
    "涉诈",
    "养老诈骗",
    "兼职",
    "杀猪盘",
)
ANTI_FRAUD_CONTENT_KEYWORDS = ANTI_FRAUD_DISCOVERY_KEYWORDS + (
    "96110",
    "全民反诈",
    "验证码",
    "银行卡",
    "转账",
    "陌生链接",
    "安全账户",
    "虚假平台",
    "冒充警察",
    "冒充客服",
)

_TITLE_RE = re.compile(r'<div class="title">(.*?)</div>', re.S)
_SOURCE_RE = re.compile(r'来源：([^<]+)</li>', re.S)
_PUBLISHED_RE = re.compile(r'发布时间：([^<]+)</li>', re.S)
_CONTENT_RE = re.compile(r'<div class="txt_txt" id="zoom">(.*?)</div>\s*<div class="txt_etr">', re.S)
_PARAGRAPH_RE = re.compile(r'<p[^>]*>(.*?)</p>', re.S | re.I)
_LINK_RE = re.compile(
    r'<a[^>]+href=["\']([^"\']+)["\'][^>]*(?:title=["\']([^"\']*)["\'])?[^>]*>(.*?)</a>',
    re.S | re.I,
)
_TITLE_TAG_RE = re.compile(r"<title>(.*?)</title>", re.S | re.I)
_TAG_RE = re.compile(r"<[^>]+>")
_BR_RE = re.compile(r"<br\s*/?>", re.I)
_COMMENT_RE = re.compile(r"<!--.*?-->", re.S)
_SCRIPT_RE = re.compile(r"<script\b.*?</script>", re.S | re.I)
_STYLE_RE = re.compile(r"<style\b.*?</style>", re.S | re.I)
_IMG_RE = re.compile(r'<img[^>]+src=["\']([^"\']+)["\']', re.I)
_VIDEO_RE = re.compile(r'<(?:video|source)[^>]+src=["\']([^"\']+)["\']', re.I)
_META_TAG_RE = re.compile(r"<meta\b([^>]+?)/?>", re.I)
_ATTR_RE = re.compile(r'([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(["\'])(.*?)\2', re.S)
_CASE_MARKER_RE = re.compile(r"^案例([一二三四五六七八九十]+)$")
_CASE_INLINE_RE = re.compile(r"^案例([一二三四五六七八九十]+)\s+[：:]?\s*(.+)$")
_SECTION_RE = re.compile(r"^[一二三四五六七八九十]+、")


@dataclass(slots=True)
class ParsedCase:
    source_case_key: str
    source_name: str
    source_domain: str
    source_article_title: str
    source_article_url: str
    title: str
    summary: str | None
    content_type: str
    fraud_type: str | None
    cover_url: str | None
    tags: list[str]
    target_roles: list[str]
    warning_signs: list[str]
    prevention_actions: list[str]
    flow_nodes: list[dict]
    media_assets: list[dict]
    detail_blocks: list[dict]
    source_published_at: datetime | None
    published_at: datetime
    is_featured: bool
    raw_payload: dict


@dataclass(slots=True)
class ElementSelector:
    tag: str
    attr_name: str
    attr_value: str
    pick: str = "first"


@dataclass(slots=True)
class OfficialSourceConfig:
    key: str
    source_name: str
    parser_kind: str
    article_url_pattern: re.Pattern[str]
    selectors: tuple[ElementSelector, ...] = ()
    list_page_urls: list[str] = field(default_factory=list)
    fixed_article_urls: list[str] = field(default_factory=list)
    default_cover_url: str | None = None
    max_article_urls: int = 24
    require_content_image: bool = False


COURT_ARTICLE_PATTERN = re.compile(r"^https://www\.court\.gov\.cn/zixun/xiangqing/\d+\.html$")
BEIJING_ARTICLE_PATTERN = re.compile(
    r"^https://gaj\.beijing\.gov\.cn/xxfb/(?:jwbd|fjjx)/\d{6}/t\d+_\d+\.html$"
)
GUANGDONG_ARTICLE_PATTERN = re.compile(
    r"^https://gdga\.gd\.gov\.cn/(?:jwzx/jwyw|jmhd/xwfb)/content/post_\d+\.html$"
)
GUANGZHOU_ARTICLE_PATTERN = re.compile(
    r"^https://gaj\.gz\.gov\.cn/gaxw/ztbd/ffzp/content/post_\d+\.html$"
)

OFFICIAL_SOURCE_CONFIGS = [
    OfficialSourceConfig(
        key="court",
        source_name=COURT_SOURCE_NAME,
        parser_kind="court",
        article_url_pattern=COURT_ARTICLE_PATTERN,
        fixed_article_urls=COURT_FIXED_ARTICLE_URLS[:],
        max_article_urls=12,
    ),
    OfficialSourceConfig(
        key="beijing-police",
        source_name=BEIJING_SOURCE_NAME,
        parser_kind="official_meta",
        article_url_pattern=BEIJING_ARTICLE_PATTERN,
        selectors=(ElementSelector("div", "id", "mainText"),),
        list_page_urls=(
            _build_index_pages("https://gaj.beijing.gov.cn/xxfb/jwbd/index.html", page_count=4, next_page_start=1)
            + _build_index_pages("https://gaj.beijing.gov.cn/xxfb/fjjx/index.html", page_count=4, next_page_start=1)
        ),
        fixed_article_urls=[
            "https://gaj.beijing.gov.cn/xxfb/fjjx/202305/t20230525_3113821.html",
            "https://gaj.beijing.gov.cn/xxfb/jwbd/202505/t20250529_4101559.html",
            "https://gaj.beijing.gov.cn/xxfb/jwbd/202507/t20250716_4150988.html",
            "https://gaj.beijing.gov.cn/xxfb/jwbd/202604/t20260402_4573431.html",
        ],
        max_article_urls=24,
    ),
    OfficialSourceConfig(
        key="guangdong-police",
        source_name=GUANGDONG_SOURCE_NAME,
        parser_kind="official_meta",
        article_url_pattern=GUANGDONG_ARTICLE_PATTERN,
        selectors=(ElementSelector("div", "class", "TRS_Editor", pick="last"),),
        list_page_urls=(
            _build_index_pages("https://gdga.gd.gov.cn/jwzx/jwyw/index.html", page_count=4, next_page_start=2)
            + _build_index_pages("https://gdga.gd.gov.cn/jmhd/xwfb/index.html", page_count=4, next_page_start=2)
        ),
        fixed_article_urls=[
            "https://gdga.gd.gov.cn/jwzx/jwyw/content/post_4281874.html",
            "https://gdga.gd.gov.cn/jwzx/jwyw/content/post_4380578.html",
            "https://gdga.gd.gov.cn/jmhd/xwfb/content/post_4516361.html",
        ],
        max_article_urls=24,
    ),
    OfficialSourceConfig(
        key="guangzhou-police",
        source_name=GUANGZHOU_SOURCE_NAME,
        parser_kind="official_meta",
        article_url_pattern=GUANGZHOU_ARTICLE_PATTERN,
        selectors=(ElementSelector("div", "class", "article-content"),),
        list_page_urls=_build_index_pages(
            "https://gaj.gz.gov.cn/gaxw/ztbd/ffzp/index.html",
            page_count=2,
            next_page_start=2,
        ),
        fixed_article_urls=[
            "https://gaj.gz.gov.cn/gaxw/ztbd/ffzp/content/post_9829321.html",
            "https://gaj.gz.gov.cn/gaxw/ztbd/ffzp/content/post_10681343.html",
            "https://gaj.gz.gov.cn/gaxw/ztbd/ffzp/content/post_10602151.html",
        ],
        max_article_urls=30,
        require_content_image=True,
    ),
]


def list_official_source_names() -> list[str]:
    return [item.source_name for item in OFFICIAL_SOURCE_CONFIGS]


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _fetch_html(url: str, *, timeout: int = 20) -> str:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
            )
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8", errors="ignore")


def _parse_attrs(fragment: str) -> dict[str, str]:
    return {key.lower(): value for key, _, value in _ATTR_RE.findall(fragment)}


def _clean_text(value: str) -> str:
    value = _BR_RE.sub("\n", value)
    value = _TAG_RE.sub("", value)
    value = html.unescape(value)
    value = value.replace("\u3000", " ").replace("\xa0", " ").replace("\u200b", "")
    value = re.sub(r"[ \t\r\f\v]+", " ", value)
    value = re.sub(r"\n+", "\n", value)
    return value.strip(" \n")


def _normalize_title(value: str) -> str:
    return re.sub(r"\s+", "", value)


def _normalize_list(values: list[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for item in values:
        normalized = item.strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        result.append(normalized)
    return result


def _dedupe_keep_order(values: list[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for item in values:
        normalized = item.strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        result.append(normalized)
    return result


def _parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    cleaned = value.strip()
    for pattern in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(cleaned, pattern).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def _extract_meta_content(page_html: str, *names: str) -> str | None:
    if not names:
        return None
    name_set = {name.lower() for name in names}
    for fragment in _META_TAG_RE.findall(page_html):
        attrs = _parse_attrs(fragment)
        candidate_keys = [attrs.get("name"), attrs.get("property"), attrs.get("itemprop")]
        if any((candidate or "").lower() in name_set for candidate in candidate_keys):
            content = attrs.get("content")
            if content:
                return _clean_text(content)
    return None


def _extract_title_tag(page_html: str) -> str | None:
    title_match = _TITLE_TAG_RE.search(page_html)
    if title_match is None:
        return None
    title = _clean_text(title_match.group(1))
    suffixes = (
        " - 中华人民共和国最高人民法院",
        "_分局警讯_北京市公安局",
        "_警务报道_北京市公安局",
        "_北京市公安局",
        " - 广东省公安厅网站",
        "广东省公安厅网站",
    )
    for suffix in suffixes:
        if title.endswith(suffix):
            title = title[: -len(suffix)].strip(" _-")
    return title or None


def _strip_noise(content_html: str) -> str:
    cleaned = _COMMENT_RE.sub("", content_html)
    cleaned = _SCRIPT_RE.sub("", cleaned)
    cleaned = _STYLE_RE.sub("", cleaned)
    return cleaned


def _extract_element_html(page_html: str, selector: ElementSelector) -> str | None:
    opening_re = re.compile(rf"<{selector.tag}\b([^>]*)>", re.I)
    matches = []
    for match in opening_re.finditer(page_html):
        attrs = _parse_attrs(match.group(1))
        attr_value = attrs.get(selector.attr_name.lower())
        if not attr_value:
            continue
        if selector.attr_name.lower() == "class":
            class_names = attr_value.split()
            if selector.attr_value not in class_names and selector.attr_value not in attr_value:
                continue
        elif selector.attr_value not in attr_value:
            continue
        matches.append(match)

    if not matches:
        return None

    target = matches[-1] if selector.pick == "last" else matches[0]
    token_re = re.compile(rf"<{selector.tag}\b[^>]*>|</{selector.tag}>", re.I)
    balance = 1
    for token in token_re.finditer(page_html, target.end()):
        token_text = token.group(0).lower()
        if token_text.startswith(f"</{selector.tag}"):
            balance -= 1
            if balance == 0:
                return page_html[target.end() : token.start()]
        else:
            balance += 1
    return None


def _extract_content_html(page_html: str, selectors: tuple[ElementSelector, ...]) -> str | None:
    for selector in selectors:
        content_html = _extract_element_html(page_html, selector)
        if content_html:
            return content_html
    return None


def _extract_paragraphs(content_html: str) -> list[str]:
    cleaned_html = _strip_noise(content_html)
    paragraphs = [_clean_text(item) for item in _PARAGRAPH_RE.findall(cleaned_html)]
    filtered = [paragraph for paragraph in paragraphs if paragraph]
    if filtered:
        return filtered
    fallback_text = _clean_text(cleaned_html)
    return [line.strip() for line in fallback_text.split("\n") if line.strip()]


def _extract_content_images(page_url: str, content_html: str) -> list[str]:
    cleaned_html = _strip_noise(content_html)
    return _dedupe_keep_order([urljoin(page_url, item) for item in _IMG_RE.findall(cleaned_html)])


def _extract_content_videos(page_url: str, content_html: str) -> list[str]:
    cleaned_html = _strip_noise(content_html)
    candidates = []
    for item in _VIDEO_RE.findall(cleaned_html):
        url = urljoin(page_url, item)
        if url.lower().endswith((".mp4", ".m3u8", ".flv")):
            candidates.append(url)
    return _dedupe_keep_order(candidates)


def _extract_cover_url(page_url: str, page_html: str, content_html: str, *, default: str | None = None) -> str | None:
    meta_image = _extract_meta_content(page_html, "image", "og:image")
    if meta_image:
        return urljoin(page_url, meta_image)

    content_images = _extract_content_images(page_url, content_html)
    if content_images:
        return content_images[0]

    return default


def _build_section_blocks(case_paragraphs: list[str]) -> list[dict]:
    blocks: list[dict] = []
    current_title = "案例说明"
    current_paragraphs: list[str] = []

    for paragraph in case_paragraphs:
        if _SECTION_RE.match(paragraph):
            if current_paragraphs:
                blocks.append({"title": current_title, "paragraphs": current_paragraphs[:]})
            current_title = paragraph
            current_paragraphs = []
            continue
        current_paragraphs.append(paragraph)

    if current_paragraphs:
        blocks.append({"title": current_title, "paragraphs": current_paragraphs[:]})
    return blocks


def _summary_from_blocks(blocks: list[dict]) -> str | None:
    for block in blocks:
        paragraphs = [item for item in block.get("paragraphs", []) if item]
        if paragraphs:
            return paragraphs[0]
    return None


def _build_case_key(source_name: str, title: str) -> str:
    normalized = f"{source_name}::{_normalize_title(title)}"
    return hashlib.sha1(normalized.encode("utf-8")).hexdigest()


def _infer_fraud_type(text: str) -> str | None:
    mapping = [
        (("AI拟声", "冒充孙子", "冒充亲属"), "AI拟声冒充亲友"),
        (("招聘", "兼职", "培训", "学费"), "求职培训诈骗"),
        (("掩饰、隐瞒犯罪所得", "代购", "奢侈品", "手表"), "洗钱跑分"),
        (("两卡", "帮助信息网络犯罪活动", "银行卡", "POS机"), "两卡帮信"),
        (("养老金", "残疾人补贴", "骗保", "补贴"), "骗保骗补"),
        (("医托", "保健品", "报名费", "押金"), "民生消费诈骗"),
        (("投资", "黄金", "导师", "直播间"), "虚假投资诈骗"),
        (("跨境", "电信网络诈骗"), "跨境电诈"),
        (("诈骗",), "电信网络诈骗"),
    ]
    for keywords, fraud_type in mapping:
        if any(keyword in text for keyword in keywords):
            return fraud_type
    return None


def _fraud_profile(fraud_type: str | None) -> dict:
    profiles = {
        "AI拟声冒充亲友": {
            "tags": ["AI拟声", "冒充亲友", "老年风险", "上门取款"],
            "roles": ["elder", "youth"],
            "warnings": ["亲友突然求助", "要求立即转账", "电话中催促保密", "线下上门取现"],
            "actions": ["先挂断核验", "回拨家属原号码", "拒绝现金交付", "立即报警留证"],
            "flow": ["采集声音", "伪装亲友", "制造紧急情境", "上门取款", "转移赃款"],
        },
        "求职培训诈骗": {
            "tags": ["兼职", "培训费", "就业诈骗", "贷款交费"],
            "roles": ["youth"],
            "warnings": ["零门槛高薪", "先交培训费", "承诺包就业", "诱导分期贷款"],
            "actions": ["核验公司资质", "拒绝先交费", "警惕培训贷", "保留聊天与转账记录"],
            "flow": ["发布招聘", "承诺兼职", "诱导缴费", "继续加码", "失联停课"],
        },
        "虚假投资诈骗": {
            "tags": ["投资", "荐股荐金", "假平台", "高收益"],
            "roles": ["youth", "elder"],
            "warnings": ["陌生人荐股", "导师带单群", "晒收益截图", "要求充值到陌生平台"],
            "actions": ["只用持牌平台", "拒绝陌生带单", "先核验平台备案", "发现异常立即止付"],
            "flow": ["社交引流", "包装导师", "诱导充值", "制造盈利假象", "转移资金"],
        },
        "两卡帮信": {
            "tags": ["两卡", "帮信", "支付结算", "跑分"],
            "roles": ["youth"],
            "warnings": ["出租出借银行卡", "提供手机卡", "异常流水返利", "代刷流水赚佣金"],
            "actions": ["不租不借两卡", "发现异常流水立刻挂失", "主动报案说明", "拒绝代收代转"],
            "flow": ["招募卡主", "交付两卡", "分流赃款", "多级转账", "提现销赃"],
        },
        "骗保骗补": {
            "tags": ["养老金", "补贴", "骗保", "民生资金"],
            "roles": ["elder", "youth"],
            "warnings": ["冒领养老金", "伪造资格材料", "虚构残疾或困难身份", "重复领取补贴"],
            "actions": ["及时申报身份变化", "核验补贴申请材料", "发现冒领立即举报", "同步留存经办记录"],
            "flow": ["伪造身份", "骗取资格", "持续冒领", "规避核验", "侵占民生资金"],
        },
        "民生消费诈骗": {
            "tags": ["医托", "保健品", "赛事名额", "消费骗局"],
            "roles": ["elder", "youth"],
            "warnings": ["免费礼品引流", "虚假专家问诊", "名额押金先付", "高价销售无效产品"],
            "actions": ["不要私下跟单", "核验医院和赛事渠道", "拒绝高价保健品推销", "发现异常及时止付报案"],
            "flow": ["线下引流", "制造稀缺", "诱导付款", "虚假交付", "持续加码"],
        },
        "洗钱跑分": {
            "tags": ["洗钱", "代购", "奢侈品", "跑分"],
            "roles": ["youth", "elder"],
            "warnings": ["脱离平台私下交易", "要求先提供银行卡", "高频跨省见面", "以代购名义走账"],
            "actions": ["坚持平台交易", "拒绝陌生代购", "异常资金立即冻结", "配合警方追踪物流"],
            "flow": ["联系卖家", "脱离平台", "诈骗转账", "线下取货", "邮寄变现"],
        },
        "跨境电诈": {
            "tags": ["跨境", "电诈窝点", "社交引流", "高收益"],
            "roles": ["youth", "elder"],
            "warnings": ["境外平台投资", "陌生导师带单", "诱导入群直播", "高收益无风险"],
            "actions": ["核验平台与公司", "不信稳赚承诺", "发现异常立刻止付", "同步保存群聊证据"],
            "flow": ["批量引流", "打造人设", "诱导入群", "虚假交易", "分层洗钱"],
        },
        "电信网络诈骗": {
            "tags": ["电诈", "资金转移", "陌生来电", "高风险"],
            "roles": ["child", "youth", "elder"],
            "warnings": ["陌生联系突然索款", "要求转到私人账户", "制造紧急气氛", "拒绝线下见面核验"],
            "actions": ["先核验再转账", "拒绝共享验证码", "保留证据立即报警", "必要时拨打96110"],
            "flow": ["陌生接触", "建立信任", "诱导操作", "资金转移", "销毁痕迹"],
        },
    }
    return profiles.get(fraud_type or "", profiles["电信网络诈骗"])


def _infer_theme_tags(
    title: str,
    paragraphs: list[str],
    source_name: str,
    source_published_at: datetime | None,
) -> list[str]:
    text = "\n".join([title, *paragraphs[:12]])
    tags: list[str] = []

    if source_name == COURT_SOURCE_NAME:
        tags.extend(["典型案例", "法院通报"])
    else:
        tags.extend(["官方发布", "各地动态"])

    if any(keyword in text for keyword in ("案例", "曝光", "劝阻", "被骗", "涉诈", "典型案例", "最新诈骗")):
        tags.append("案例预警")
    if any(keyword in text for keyword in ("提醒", "提示", "指南", "宣讲", "课堂", "科普", "知识", "反诈", "防骗", "揭秘")):
        tags.append("反诈知识")
    if source_published_at and source_published_at >= _utcnow() - timedelta(days=90):
        tags.append("时事热点")

    return _normalize_list(tags)


def _is_antifraud_article(title: str, paragraphs: list[str]) -> bool:
    text = "\n".join([title, *paragraphs[:18]])
    return any(keyword in text for keyword in ANTI_FRAUD_CONTENT_KEYWORDS)


def _build_media_assets(*, cover_url: str | None, source_url: str, page_url: str, content_html: str) -> list[dict]:
    assets: list[dict] = []
    image_urls = _extract_content_images(page_url, content_html)
    if cover_url and cover_url not in image_urls:
        image_urls.insert(0, cover_url)

    for image_url in image_urls[:6]:
        assets.append({"type": "image", "url": image_url, "thumbnail_url": image_url})

    for video_url in _extract_content_videos(page_url, content_html)[:2]:
        assets.append({"type": "video", "url": video_url, "thumbnail_url": cover_url})

    assets.append({"type": "link", "url": source_url})
    return assets


def _build_case_payload(
    *,
    source_name: str,
    parser_kind: str,
    release_title: str,
    release_url: str,
    release_source: str,
    release_published_at: datetime | None,
    cover_url: str | None,
    marker: str,
    title: str,
    case_paragraphs: list[str],
    media_assets: list[dict],
) -> ParsedCase:
    merged_text = "\n".join([title, *case_paragraphs])
    fraud_type = _infer_fraud_type(merged_text)
    profile = _fraud_profile(fraud_type)
    section_blocks = _build_section_blocks(case_paragraphs)
    summary = _summary_from_blocks(section_blocks)
    theme_tags = _infer_theme_tags(title, case_paragraphs, source_name, release_published_at)
    combined_tags = _normalize_list([*profile["tags"], *theme_tags])
    now = _utcnow()
    return ParsedCase(
        source_case_key=_build_case_key(source_name, title),
        source_name=source_name,
        source_domain=urlparse(release_url).netloc,
        source_article_title=release_title,
        source_article_url=release_url,
        title=title,
        summary=summary,
        content_type="article",
        fraud_type=fraud_type,
        cover_url=cover_url,
        tags=combined_tags,
        target_roles=_normalize_list(profile["roles"]),
        warning_signs=_normalize_list(profile["warnings"]),
        prevention_actions=_normalize_list(profile["actions"]),
        flow_nodes=[
            {"id": f"{index + 1}", "label": label, "tone": "accent"}
            for index, label in enumerate(profile["flow"])
        ],
        media_assets=media_assets,
        detail_blocks=section_blocks,
        source_published_at=release_published_at,
        published_at=release_published_at or now,
        is_featured=bool(
            "案例预警" in combined_tags
            or "时事热点" in combined_tags
            or fraud_type in {"AI拟声冒充亲友", "虚假投资诈骗", "跨境电诈"}
            or "老年" in merged_text
            or "AI拟声" in merged_text
        ),
        raw_payload={
            "marker": marker,
            "content_source": release_source,
            "parser_kind": parser_kind,
            "paragraph_count": len(case_paragraphs),
            "image_count": len([item for item in media_assets if item.get("type") == "image"]),
        },
    )


def parse_release(url: str) -> list[ParsedCase]:
    page_html = _fetch_html(url)
    title_match = _TITLE_RE.search(page_html)
    source_match = _SOURCE_RE.search(page_html)
    published_match = _PUBLISHED_RE.search(page_html)
    content_match = _CONTENT_RE.search(page_html)

    if title_match is None or content_match is None:
        raise ValueError(f"未能解析案例发布页：{url}")

    release_title = _clean_text(title_match.group(1))
    release_source = _clean_text(source_match.group(1)) if source_match else COURT_SOURCE_NAME
    release_published_at = _parse_datetime(_clean_text(published_match.group(1)) if published_match else None)
    content_html = content_match.group(1)
    court_images = _extract_content_images(url, content_html)
    cover_url = court_images[0] if court_images else None
    media_assets = _build_media_assets(cover_url=cover_url, source_url=url, page_url=url, content_html=content_html)
    paragraphs = _extract_paragraphs(content_html)

    marker_entries: list[tuple[int, str, str | None]] = []
    for index, paragraph in enumerate(paragraphs):
        exact_match = _CASE_MARKER_RE.match(paragraph)
        if exact_match:
            marker_entries.append((index, paragraph, None))
            continue

        inline_match = _CASE_INLINE_RE.match(paragraph)
        if inline_match:
            marker_entries.append((index, f"案例{inline_match.group(1)}", inline_match.group(2).strip()))

    if not marker_entries:
        return [
            _build_case_payload(
                source_name=COURT_SOURCE_NAME,
                parser_kind="court",
                release_title=release_title,
                release_url=url,
                release_source=release_source,
                release_published_at=release_published_at,
                cover_url=cover_url,
                marker="全文",
                title=release_title,
                case_paragraphs=paragraphs,
                media_assets=media_assets,
            )
        ]

    case_items: list[ParsedCase] = []
    for offset, entry in enumerate(marker_entries):
        marker_index, marker, inline_title = entry
        next_index = marker_entries[offset + 1][0] if offset + 1 < len(marker_entries) else len(paragraphs)

        if inline_title:
            case_title = inline_title
            case_paragraphs = paragraphs[marker_index + 1 : next_index]
        else:
            title_index = marker_index + 1
            while title_index < next_index and not paragraphs[title_index]:
                title_index += 1
            if title_index >= next_index:
                continue
            case_title = paragraphs[title_index]
            case_paragraphs = paragraphs[title_index + 1 : next_index]

        if not case_paragraphs:
            continue

        case_items.append(
            _build_case_payload(
                source_name=COURT_SOURCE_NAME,
                parser_kind="court",
                release_title=release_title,
                release_url=url,
                release_source=release_source,
                release_published_at=release_published_at,
                cover_url=cover_url,
                marker=marker,
                title=case_title,
                case_paragraphs=case_paragraphs,
                media_assets=media_assets,
            )
        )

    return case_items


def _extract_links(page_url: str, page_html: str) -> list[tuple[str, str]]:
    links: list[tuple[str, str]] = []
    for href, title_attr, inner_html in _LINK_RE.findall(page_html):
        title = _clean_text(title_attr or inner_html)
        if not title:
            continue
        links.append((urljoin(page_url, href), title))
    return links


def _is_discovery_candidate(title: str) -> bool:
    return any(keyword in title for keyword in ANTI_FRAUD_DISCOVERY_KEYWORDS)


def _discover_article_urls(config: OfficialSourceConfig) -> list[str]:
    urls = list(config.fixed_article_urls)

    for page_url in config.list_page_urls:
        try:
            page_html = _fetch_html(page_url)
        except Exception as exc:
            logger.warning("案例列表页抓取失败：%s (%s)", page_url, exc)
            continue

        for article_url, title in _extract_links(page_url, page_html):
            if not config.article_url_pattern.search(article_url):
                continue
            if not _is_discovery_candidate(title):
                continue
            urls.append(article_url)

    return _dedupe_keep_order(urls)[: config.max_article_urls]


def _match_source_config(url: str) -> OfficialSourceConfig | None:
    for config in OFFICIAL_SOURCE_CONFIGS:
        if config.article_url_pattern.search(url):
            return config
    return None


def _parse_official_meta_article(url: str, config: OfficialSourceConfig) -> list[ParsedCase]:
    page_html = _fetch_html(url)
    release_title = (
        _extract_meta_content(page_html, "ArticleTitle")
        or _extract_title_tag(page_html)
        or _clean_text(urlparse(url).path.rsplit("/", 1)[-1])
    )
    release_source = _extract_meta_content(page_html, "ContentSource") or config.source_name
    release_published_at = _parse_datetime(_extract_meta_content(page_html, "PubDate"))
    content_html = _extract_content_html(page_html, config.selectors)

    if not content_html:
        raise ValueError(f"未能解析正文：{url}")

    paragraphs = _extract_paragraphs(content_html)
    if not paragraphs:
        raise ValueError(f"正文为空：{url}")
    if not _is_antifraud_article(release_title, paragraphs):
        return []
    if config.require_content_image and not _extract_content_images(url, content_html):
        return []

    cover_url = _extract_cover_url(url, page_html, content_html, default=config.default_cover_url)
    media_assets = _build_media_assets(cover_url=cover_url, source_url=url, page_url=url, content_html=content_html)
    return [
        _build_case_payload(
            source_name=config.source_name,
            parser_kind=config.parser_kind,
            release_title=release_title,
            release_url=url,
            release_source=release_source,
            release_published_at=release_published_at,
            cover_url=cover_url,
            marker="全文",
            title=release_title,
            case_paragraphs=paragraphs,
            media_assets=media_assets,
        )
    ]


def parse_article(url: str) -> list[ParsedCase]:
    config = _match_source_config(url)
    if config is None:
        raise ValueError(f"不支持的案例来源：{url}")

    if config.parser_kind == "court":
        return parse_release(url)
    return _parse_official_meta_article(url, config)


def crawl_cases(extra_article_urls: list[str] | None = None) -> list[ParsedCase]:
    scheduled_urls: list[str] = []
    for config in OFFICIAL_SOURCE_CONFIGS:
        scheduled_urls.extend(_discover_article_urls(config))
    if extra_article_urls:
        scheduled_urls.extend(extra_article_urls)

    items: list[ParsedCase] = []
    for url in _dedupe_keep_order(scheduled_urls):
        config = _match_source_config(url)
        if config is None:
            logger.warning("跳过未支持的案例来源：%s", url)
            continue
        try:
            items.extend(parse_article(url))
        except Exception as exc:
            logger.warning("案例抓取失败：%s (%s)", url, exc)

    if not items:
        raise ValueError("未抓取到有效反诈案例")
    return items
