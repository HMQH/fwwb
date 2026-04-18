"""反诈学习服务：专题、刷题与 AI 模拟诈骗。"""
from __future__ import annotations

import json
import random
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.domain.cases import repository as cases_repository
from app.domain.cases.entity import FraudCase
from app.domain.learning.llm import build_learning_chat_client
from app.domain.learning.runtime import (
    append_simulation_message,
    create_simulation_session,
    finish_simulation_session,
    get_cached_quiz_questions,
    get_simulation_session,
    store_quiz_questions,
    utcnow,
)
from app.shared.fraud_taxonomy import (
    RECOMMENDED_CATEGORY_KEY,
    build_case_categories,
    get_topic_definition,
    list_learning_topics,
    recommendation_score,
    resolve_learning_topic,
    topic_priority_for_role,
)

_DEFAULT_CASE_ACTIONS: dict[str, list[str]] = {
    "financial_fraud": ["暂停转账", "核验平台", "保留记录", "联系银行止付"],
    "social_fraud": ["停止私聊", "核验身份", "拒绝加群转账", "保留证据"],
    "impersonation_fraud": ["挂断核验", "拒绝验证码", "回拨官方电话", "联系家人确认"],
    "transaction_fraud": ["坚持平台交易", "拒绝私下收款", "核验订单", "冻结异常账户"],
    "job_fraud": ["核验公司", "拒绝先交费", "警惕培训贷", "保存聊天记录"],
    "livelihood_fraud": ["核验官方渠道", "拒绝高价推销", "停止付款", "立即报警"],
    "other_fraud": ["先核验", "不转账", "不点链接", "保留证据"],
}

_SIMULATION_SCENE_LIBRARY: dict[str, list[dict[str, Any]]] = {
    "financial_fraud": [
        {
            "tokens": ("荐股", "带单", "收益", "黄金", "平台", "投资"),
            "title": "导师带单补仓",
            "summary": "私聊拉群后催你补仓入金",
            "channel": "私聊 + 内部群",
            "hook": "晒收益截图",
            "persona_label": "投资导师助理",
            "tags": ["导师带单", "补仓催单", "假平台"],
            "openings": [
                "老师刚在内部群点了一只票，下午还有一波，名额我先给你留着。你别在公屏问，先把平台打开，我带你补仓。",
                "你昨天看的那只票已经开始拉升了，老师让我单独提醒你，今天这波补进去很关键。先跟着操作，晚了就进不去了。",
            ],
            "stage_messages": [
                "先别分神，你把开户链接点开，账户开通后我再把老师的提示同步给你。",
                "这边走的是内部策略，不方便公开发，你先把首笔仓位补上，后面我带你止盈。",
                "老师看的就是进场节奏，你现在犹豫，后面成本就抬高了。",
                "你先不要和别人讨论，很多人就是慢一步，结果错过整段行情。",
            ],
            "reject_messages": [
                "我是在帮你卡最后的进场位，不是让你乱投，机会错过就没了。",
                "你先别急着拒绝，老师今天只给老成员留了窗口，我才单独来提醒你。",
            ],
            "verify_messages": [
                "这种内部策略不会公开讲，你真去外面问，名额反而会被锁掉。",
                "平台这边是独立开户链接，你按步骤开通就行，等会儿我把老师语音发你。",
            ],
        },
        {
            "tokens": ("返利", "充值", "高收益", "刷单", "佣金", "返佣"),
            "title": "高收益返利加单",
            "summary": "先小额返利，再诱导继续充值",
            "channel": "活动群",
            "hook": "小单秒返",
            "persona_label": "返利活动专员",
            "tags": ["高收益", "先充值", "继续加单"],
            "openings": [
                "你刚做的新手单已经通过了，再补一笔高阶单，返利会直接翻倍。现在名额还在，你先把额度补上。",
                "平台活动只剩最后一档了，你今天再充一笔，系统会一起结算返佣。别等过点，过了就回不到这个档位。",
            ],
            "stage_messages": [
                "前面这笔已经在排队结算了，你现在补单才能一起释放，不然资金会卡在中间。",
                "金额不是重点，重点是把流水做完整，不完整系统不会回款。",
                "你先把这一轮做完，后面我帮你申请快速提现。",
                "别中途停，停了就会被判定异常单，前面的返利也拿不到。",
            ],
            "reject_messages": [
                "你前面的额度已经挂上去了，现在停掉反而最亏。",
                "我不是催你花钱，是帮你把已经做了一半的流程走完。",
            ],
            "verify_messages": [
                "这是活动结算规则，不是我一个人能改的，你照着流程做就能拿回去。",
                "你要核实也行，但现在活动窗口开着，等你核完这档位就没了。",
            ],
        },
    ],
    "social_fraud": [
        {
            "tokens": ("交友", "网恋", "群聊", "引流", "好友", "跨境"),
            "title": "聊熟后拉群",
            "summary": "先建立信任，再拉你进圈子",
            "channel": "社交平台私聊",
            "hook": "聊熟 + 分享机会",
            "persona_label": "热心网友",
            "tags": ["先聊熟", "私聊拉群", "信任诱导"],
            "openings": [
                "我看你平时挺会聊的，刚好我这边有个小圈子，都是熟人一起做。你先别公开问，我把群入口单独发你。",
                "咱们聊了几天感觉你人挺靠谱，我才想带你进这个群。里面消息更新快，你先进来看看，不合适再说。",
            ],
            "stage_messages": [
                "群里不太欢迎陌生人直接问收益，你先跟着看两天，我再带你认识里面的人。",
                "大家都是熟人互相带，不会像外面那种公开乱发的，你先按我说的进来。",
                "现在群里正好在讲机会点，晚一点消息就刷过去了。",
                "别老想着查来查去，真想带你的人反而不会一直公开喊。",
            ],
            "reject_messages": [
                "我也是看你聊得来才带你，不愿意就算了，只是这个机会过了挺可惜。",
                "你别把我当成外面随便拉人的，我要不是觉得你靠谱，也不会单独来找你。",
            ],
            "verify_messages": [
                "这圈子本来就比较封闭，你真去外面问，别人也不会知道里面怎么操作。",
                "你先进来潜水看看就知道了，没必要一开始就把气氛弄得太僵。",
            ],
        },
        {
            "tokens": ("直播", "导师", "境外", "平台", "群", "高收益"),
            "title": "直播间助理引流",
            "summary": "直播间或短视频私信转到封闭群",
            "channel": "直播私信",
            "hook": "名额有限",
            "persona_label": "直播间助理",
            "tags": ["直播引流", "限时名额", "封闭群"],
            "openings": [
                "你刚才在直播间问得挺准的，老师这边有个内圈群，不是每个人都能进。我先给你留个口子，你低调进来。",
                "老师刚下播，外面的人还在排队，我先把内部群入口给你。群里会发更细的操作节奏。",
            ],
            "stage_messages": [
                "群里不公开发这些内容，你先进来再说，外面留言区很快就刷掉了。",
                "老师只看愿意跟的人，你先进群保持在线，后面有消息我直接提醒你。",
                "这批名额是临时开的，你如果拖太久，管理员会先放给后面的人。",
                "先别在公开区继续问，进群后我单独给你对接。",
            ],
            "reject_messages": [
                "我这边只是顺手给你留入口，错过了就只能等下一轮。",
                "你如果不愿意进也没事，但老师这边不会重复开同一批口子。",
            ],
            "verify_messages": [
                "直播间本来就不会把核心内容公开讲，真公开了早就乱套了。",
                "你先进群观察就行，不满意再退，没必要现在卡在这一步。",
            ],
        },
    ],
    "impersonation_fraud": [
        {
            "tokens": ("亲友", "AI拟声", "熟人", "上门取款", "求助"),
            "title": "亲友语音急借钱",
            "summary": "冒充熟人求助，催你马上转账",
            "channel": "电话 + 语音",
            "hook": "临时救急",
            "persona_label": "熟人",
            "tags": ["AI拟声", "亲友求助", "保密催促"],
            "openings": [
                "我现在不方便细说，人在外面处理事，手机也快没电了。你先帮我垫一下，我晚点把钱转回你。",
                "先别问太细，我这边情况有点急，正找人帮我周转。你先按我说的转一下，等下我再跟你解释。",
            ],
            "stage_messages": [
                "这事我不想让家里人知道，你先帮我顶一下，回头我马上补给你。",
                "我现在没法慢慢说，窗口就这么一会儿，你先把这笔处理掉。",
                "对方就在催我，我这边要是拖住了更麻烦，你先别问那么多。",
                "你先别和别人说，事情传开了会更乱，我处理完第一时间找你。",
            ],
            "reject_messages": [
                "我不是骗你，真的是现在卡住了，才会第一时间想到你。",
                "你先别这样，我都开口找你了，说明真的是没办法了。",
            ],
            "verify_messages": [
                "我现在不方便视频，也不方便跟你长聊，事情一结束我就联系你。",
                "你要是一直核实，我这边真来不及了，先把眼前这关过了再说。",
            ],
        },
        {
            "tokens": ("客服", "百万保障", "扣费", "账户异常", "售后"),
            "title": "客服取消扣费",
            "summary": "冒充平台客服，称账户异常或将自动扣费",
            "channel": "客服电话",
            "hook": "自动扣费 / 账户异常",
            "persona_label": "平台客服",
            "tags": ["冒充客服", "取消扣费", "账户异常"],
            "openings": [
                "您好，这里是平台售后，您名下的保障服务即将自动扣费。现在帮您走关闭流程，您配合一下就行。",
                "您好，系统检测到您账户刚触发异常扣费提醒，这边给您加急处理。您先别操作别的，按我说的来。",
            ],
            "stage_messages": [
                "现在是系统加急窗口，流程做完就能把扣费项目关掉，您先跟着操作。",
                "这个入口关闭后就得重新排队，您现在先把核验走完比较快。",
                "您别切出去，也别找别的页面，流程断了系统会重新计时。",
                "我这边正在帮您拦截，您先配合，不然扣费生效后就麻烦了。",
            ],
            "reject_messages": [
                "我理解您谨慎，但现在不处理，扣费一旦生成就不是我这边能立刻拦住的了。",
                "我是在帮您取消，不是让您付钱，您先别把流程中断。",
            ],
            "verify_messages": [
                "官方热线现在排队很长，您先把当前流程走完，我这边就是加急通道。",
                "您要核实可以，但系统这边已经在倒计时，晚了会自动续上。",
            ],
        },
        {
            "tokens": ("公安", "公检法", "协查", "案件", "涉案"),
            "title": "专线通知涉案",
            "summary": "以案件协查为名，制造恐慌和控制感",
            "channel": "专线电话",
            "hook": "涉案 / 安全审查",
            "persona_label": "专线人员",
            "tags": ["涉案通知", "恐吓施压", "要求配合"],
            "openings": [
                "您好，这里是案件协查专线，您的身份信息牵涉到一笔异常资金。现在需要您单独配合核查，请保持通话。",
                "您先不要紧张，我们这边在做紧急核查。您的账户信息涉及异常记录，需要马上配合处理。",
            ],
            "stage_messages": [
                "这类核查有时效要求，您先单独配合，不要把通话内容告诉其他人。",
                "您现在最重要的是排除风险，不是四处打听，先把当前流程配合完。",
                "如果您中途退出，系统会把您标记为拒不配合，后续会更麻烦。",
                "我现在是在帮您做风险剥离，您先保持通话，按步骤确认。",
            ],
            "reject_messages": [
                "我提醒您是为了帮您尽快排除风险，您现在拖延只会让问题升级。",
                "您可以不信，但记录已经挂上了，现在是给您处理机会。",
            ],
            "verify_messages": [
                "这边是内部协查流程，您现在转接或外拨都会打断当前处理。",
                "等当前记录处理完，您再去核实都可以，现在先把这一步配合完。",
            ],
        },
    ],
    "transaction_fraud": [
        {
            "tokens": ("退款", "订单", "售后", "赔付", "理赔"),
            "title": "订单退款加急",
            "summary": "以退款售后为名诱导提供信息",
            "channel": "订单电话",
            "hook": "退款加急",
            "persona_label": "售后专员",
            "tags": ["退款客服", "加急处理", "信息核验"],
            "openings": [
                "您好，您这笔订单退款正在走加急处理，我这边给您对接人工。您先别点确认，按我这边流程核一下信息。",
                "您这单售后已经排到人工通道了，现在处理最快。您先跟着我核验，不然系统会把退款退回队列。",
            ],
            "stage_messages": [
                "现在先把收款信息对一下，系统确认成功后才能把退款打过去。",
                "您别自己乱点，页面一旦走错就会重新排队，先按我说的操作。",
                "这笔退款今天能不能下来，就看您现在这一步配不配合。",
                "我这边是在帮您加急，不然等系统重新审核至少还要很久。",
            ],
            "reject_messages": [
                "您现在不配合，退款流程就会卡住，到时还是得重新走。",
                "我不是让您付款，是帮您把这笔售后尽快处理掉。",
            ],
            "verify_messages": [
                "页面和热线不是同一条处理链路，您现在先别切出去，断了就得重来。",
                "您要核实也行，但退款通道有时效，晚了今天这批就走不了。",
            ],
        },
        {
            "tokens": ("闲置", "代购", "奢侈品", "线下见面", "私下交易"),
            "title": "脱离平台私下交易",
            "summary": "引导你脱离平台到线下或私聊",
            "channel": "二手平台私聊",
            "hook": "高价收货 / 快速成交",
            "persona_label": "买家助理",
            "tags": ["脱离平台", "线下见面", "银行卡核验"],
            "openings": [
                "你这件我这边客户能直接收，平台走流程太慢。你先把银行卡和联系方式发我，我让同事给你安排线下验货。",
                "这边买家是真心要，走平台容易被限额。你先私下对接我，我帮你把时间和付款方式定下来。",
            ],
            "stage_messages": [
                "客户今天就在附近，定下来就能见面，你先把信息发我好安排。",
                "走平台会把价格压得很死，私下处理对你更划算。",
                "你先别反复问规则，我这边是替客户对接，信息齐了才能往下排。",
                "机会不是一直有，客户转头去看别人，你这单就没了。",
            ],
            "reject_messages": [
                "你要是一直卡在平台里，成交速度肯定慢很多。",
                "我是在帮你撮合，不是故意绕流程，真想要的人都这么谈。",
            ],
            "verify_messages": [
                "平台客服不会管这种高价快收的单子，你真去问，他们只会让你自己卖。",
                "你先把客户留住，细节我这边再帮你对，别让单子跑了。",
            ],
        },
        {
            "tokens": ("跑分", "银行卡", "返利", "流水", "手机卡", "两卡"),
            "title": "刷流水返佣",
            "summary": "让你提供卡和账户帮助转账",
            "channel": "兼职群",
            "hook": "高额返佣",
            "persona_label": "结算专员",
            "tags": ["跑分", "银行卡", "高返佣"],
            "openings": [
                "这单是短时结算任务，刷流水就有佣金，你把可用卡先发我登记。做完这一轮，返佣马上结。",
                "我们这边缺临时结算通道，你只要配合过一下流水就能拿提成。今天量大，做得快赚得也快。",
            ],
            "stage_messages": [
                "你只负责过流水，别想太复杂，做完系统自动给你算返佣。",
                "卡先登记好，我这边才好给你派单，不然轮不到你。",
                "这类单子时效短，犹豫的人一多，名额马上就被别人接走了。",
                "你先把资料补齐，后面的步骤我一条条带你做。",
            ],
            "reject_messages": [
                "这不是让你出钱，是给你一个赚快钱的机会，关键看你接不接。",
                "别人都是直接上手做，你现在卡着不动，后面的单就分不到你了。",
            ],
            "verify_messages": [
                "你只是在做结算辅助，不用自己承担风险，流程都是统一的。",
                "你真想查也行，但这类任务节奏很快，查完这批基本就结束了。",
            ],
        },
    ],
    "job_fraud": [
        {
            "tokens": ("兼职", "培训费", "高薪", "包就业", "战队", "培训贷"),
            "title": "高薪兼职先培训",
            "summary": "以高薪兼职为饵，先收培训费或押金",
            "channel": "招聘私聊",
            "hook": "零门槛高薪",
            "persona_label": "招聘专员",
            "tags": ["零门槛高薪", "先交培训费", "包上岗"],
            "openings": [
                "你这边条件是能过初筛的，我们现在缺的就是这种马上能上岗的人。先把岗前培训名额锁住，今天就能安排。",
                "我看过你的信息了，兼职岗可以直接进下一步。现在先交个培训占位费，不然名额会被后面的人顶掉。",
            ],
            "stage_messages": [
                "培训不是走形式，名单录进去才能给你排班，你先把这一步办了。",
                "很多人卡在这一步不是不合适，是动作慢，名额就没了。",
                "你先别总想着等等，今天能上岗就意味着你今天开始算收益。",
                "这个岗本来就抢手，你先把席位占住，资料我后面再帮你补。",
            ],
            "reject_messages": [
                "你如果一点前期都不愿意配合，公司也没法把名额留给你。",
                "我不是让你白交，是把岗前流程先走完，不然你连排班都进不去。",
            ],
            "verify_messages": [
                "招聘系统只认这边的内部流程，你去外面问也看不到当前名额状态。",
                "你先把名额锁住再核实，不然核实完岗位已经满了。",
            ],
        },
        {
            "tokens": ("内推", "offer", "实习", "资料费", "背调", "入职"),
            "title": "内推 offer 锁位",
            "summary": "以内部推荐或实习名额名义先收费",
            "channel": "求职群",
            "hook": "内推保过",
            "persona_label": "HR 助理",
            "tags": ["内推", "offer 锁位", "资料费"],
            "openings": [
                "你的简历我已经帮你递进去了，现在卡在锁位这一步。你先把材料费补上，我才能继续往下给你推。",
                "这个实习岗竞争很大，我这边能帮你走内推通道。先把席位锁住，不然今天这批就截止了。",
            ],
            "stage_messages": [
                "锁位成功后我才能给你发后面的面试材料，不然系统里查不到你。",
                "我这边是在抢时间帮你推进，你先把前置流程办掉。",
                "名额不是一直留着的，你现在拖着，后面就只能排下一批。",
                "先把这一步完成，后面的背调和面试我再带你走。",
            ],
            "reject_messages": [
                "内推本来就比公开投递快，但前提是你自己别把节奏拖住。",
                "我是在替你争取窗口，不是单纯催你，岗位今天就会收口。",
            ],
            "verify_messages": [
                "公开渠道看不到这边的内推进度，你现在查也查不出来。",
                "你先把位置锁住，再去慢慢核也不迟，不然岗位先没了。",
            ],
        },
    ],
    "livelihood_fraud": [
        {
            "tokens": ("补贴", "养老金", "专项", "资格", "骗保"),
            "title": "补贴资格申领",
            "summary": "以补贴发放或资格复核为名催你操作",
            "channel": "通知电话",
            "hook": "补贴即将截止",
            "persona_label": "补贴专员",
            "tags": ["补贴申领", "资格复核", "截止提醒"],
            "openings": [
                "您好，您这笔专项补贴今天是最后一天复核，我这边给您走快速通道。您先别挂，按我说的把资料补齐。",
                "系统显示您这边补贴资格还差最后一步确认，不处理的话本轮就发不下来了。您现在方便配合一下吗？",
            ],
            "stage_messages": [
                "这边是集中发放批次，您先把核验做完，我才能帮您提交上去。",
                "资料一旦过了截止时间就得重新排，您现在先别拖。",
                "我这里是在帮您保住资格，您按步骤来就行。",
                "很多人就是差这最后一步没做完，结果钱一直发不下来。",
            ],
            "reject_messages": [
                "我理解您谨慎，但今天是截止点，您不处理这笔就顺延了。",
                "我不是催您花钱，是帮您把资格保住，晚了这批就发不到了。",
            ],
            "verify_messages": [
                "官方窗口现在都在集中处理，您先把这边流程走完最省时间。",
                "您要核实也可以，但当前批次的提交时间不会等人。",
            ],
        },
        {
            "tokens": ("保健品", "免费礼品", "问诊", "老年", "医托"),
            "title": "礼品引流高价推销",
            "summary": "先用免费礼品吸引，再转高价消费",
            "channel": "活动回访",
            "hook": "免费领礼品",
            "persona_label": "活动顾问",
            "tags": ["免费礼品", "专家问诊", "高价推销"],
            "openings": [
                "阿姨您好，您上次登记的免费礼品今天还能领，我这边顺便帮您把健康体验名额一起留上。您先登记一下，到了直接安排。",
                "叔叔您好，您之前参加过我们的福利活动吧？今天这边有个健康专场，礼品和体验名额一起给您留着，您先别错过。",
            ],
            "stage_messages": [
                "今天名额不多，先把信息留好，到现场我给您安排前排。",
                "专家是一对一看情况的，普通人排不上，我这是给您留了内部名额。",
                "您先不用多想，到场看看就知道了，礼品和体验都给您备着。",
                "这批活动过了就要等下次，您先把席位占住最稳妥。",
            ],
            "reject_messages": [
                "我们是给您送福利，不是强迫您买，您先把名额占了再说。",
                "这次是老客户优先，我才先来通知您，错过了后面就排不到了。",
            ],
            "verify_messages": [
                "活动名单是我们这边直接安排的，外面查不到具体座位情况。",
                "您先把席位定下来，到时来看看，不合适您再决定。",
            ],
        },
        {
            "tokens": ("赛事", "名额", "押金", "报名费", "马拉松"),
            "title": "赛事名额押金",
            "summary": "虚构稀缺名额，先收押金或报名费",
            "channel": "报名私聊",
            "hook": "稀缺名额",
            "persona_label": "报名专员",
            "tags": ["赛事名额", "押金", "限时保留"],
            "openings": [
                "你咨询的那个赛事名额我这边还能帮你留一个，但得先交押金锁位，不然系统马上放给候补。",
                "这批名额现在剩得不多，我先帮你占住。你把确认金付了，资料我再给你补录进去。",
            ],
            "stage_messages": [
                "系统只认锁位顺序，你先把位置保住，后面材料我一点点带你填。",
                "你现在不确认，候补一顶上来，这个名额就回不来了。",
                "押金不是多收，是防止有人占位不报，你先把这步走完。",
                "我这边已经帮你卡住一会儿了，再拖系统就自动释放。",
            ],
            "reject_messages": [
                "你要是一直犹豫，后面的人很快就把位置接走了。",
                "我是在帮你抢名额，不是故意催款，这类位置本来就靠手快。",
            ],
            "verify_messages": [
                "公开页面看不到实时保留状态，真等你去查完，位置基本就没了。",
                "你先锁位，后面核清楚再决定，至少不会先把机会丢掉。",
            ],
        },
    ],
    "other_fraud": [
        {
            "tokens": (),
            "title": "陌生来电加急处理",
            "summary": "借加急处理制造紧张感，诱导你跟着操作",
            "channel": "陌生来电",
            "hook": "绿色通道",
            "persona_label": "处理专员",
            "tags": ["陌生来电", "加急处理", "催促操作"],
            "openings": [
                "您好，您这边刚触发了一笔异常提醒，我现在帮您走绿色通道。您先别挂，按我说的操作会快很多。",
                "这边正在给您加急处理一个风险项，流程很快，您先配合一下，别自己乱点。",
            ],
            "stage_messages": [
                "先按我这边步骤走，流程断了就得重新排。",
                "您现在最重要的是把眼前这一步完成，后面的我来帮您盯。",
                "别再切出去问别人了，耽误的就是您自己的处理时间。",
                "我这边是在帮您止损，您先把当前操作做完。",
            ],
            "reject_messages": [
                "我只是提醒您风险，您现在拖着不做，后面麻烦会更大。",
                "不是我催您，是这个窗口就这么一会儿，错过了就要重来。",
            ],
            "verify_messages": [
                "您可以后面再核实，现在先把加急流程走完比较稳。",
                "当前处理一断开就要重新排，您先别急着切出去。",
            ],
        },
    ],
}


def list_learning_topics_overview(
    db: Session,
    *,
    topic_key: str | None,
    role: str | None,
) -> dict[str, Any]:
    cases = cases_repository.list_published_cases(db)
    counts = {item.key: 0 for item in list_learning_topics()}
    for case in cases:
        topic = resolve_learning_topic(
            fraud_type=case.fraud_type,
            title=case.title,
            summary=case.summary,
            tags=case.tags,
        )
        counts[topic.key] = counts.get(topic.key, 0) + 1

    topics = [
        {
            "key": definition.key,
            "label": definition.label,
            "description": definition.description,
            "simulation_persona": definition.simulation_persona,
            "count": counts.get(definition.key, 0),
            "quiz_count": _estimate_quiz_count(counts.get(definition.key, 0)),
        }
        for definition in list_learning_topics()
    ]

    default_topic = _pick_default_topic(topics, role=role)
    selected_key = topic_key or default_topic["key"]
    if selected_key not in {item["key"] for item in topics}:
        selected_key = default_topic["key"]
    current_topic = next(item for item in topics if item["key"] == selected_key)

    return {
        "topics": topics,
        "current_topic": current_topic,
    }


def list_learning_cases(
    db: Session,
    *,
    category: str | None,
    role: str | None,
    limit: int,
) -> dict[str, Any]:
    all_cases = cases_repository.list_published_cases(db)
    categories = build_case_categories(all_cases)
    valid_keys = {item["key"] for item in categories}

    selected_category = category or RECOMMENDED_CATEGORY_KEY
    if selected_category not in valid_keys:
        selected_category = RECOMMENDED_CATEGORY_KEY

    if selected_category == RECOMMENDED_CATEGORY_KEY:
        filtered = list(all_cases)
        filtered.sort(
            key=lambda item: (
                recommendation_score(item, role),
                1 if item.cover_url else 0,
                item.source_published_at or item.published_at or item.created_at,
                item.created_at,
                str(item.id),
            ),
            reverse=True,
        )
    else:
        filtered = _list_cases_by_topic(db, selected_category, role=role)

    latest_sync = cases_repository.get_latest_sync_run(db)
    return {
        "categories": categories,
        "current_category": selected_category,
        "total": len(filtered),
        "last_sync_at": latest_sync.finished_at if latest_sync else None,
        "items": [_serialize_learning_case(item) for item in filtered[:limit]],
    }


def get_quiz_set(
    db: Session,
    *,
    topic_key: str,
    count: int,
    role: str | None,
) -> dict[str, Any]:
    topic = get_topic_definition(topic_key)
    topic_cases = _list_cases_by_topic(db, topic_key)
    if not topic_cases:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="当前专题暂无题目")

    cached = get_cached_quiz_questions(topic.key)
    if cached:
        questions = _slice_questions(cached, count=count)
    else:
        questions = _generate_quiz_questions(topic_cases, topic_key=topic.key, role=role, count=max(count, 8))
        store_quiz_questions(topic.key, questions)
        questions = _slice_questions(questions, count=count)

    return {
        "topic_key": topic.key,
        "topic_label": topic.label,
        "generated_at": utcnow(),
        "questions": questions,
    }


def start_simulation(
    db: Session,
    *,
    topic_key: str,
    user_role: str | None,
) -> dict[str, Any]:
    topic = get_topic_definition(topic_key)
    scenario = _build_simulation_scenario(db, topic_key=topic.key, user_role=user_role)
    session = create_simulation_session(
        topic_key=topic.key,
        topic_label=topic.label,
        user_role=user_role,
        persona_label=str(scenario.get("persona_label") or topic.simulation_persona),
        opening_message=str(scenario.get("opening_message") or ""),
        scenario=scenario,
    )
    return _serialize_session(session)


def send_simulation_reply(
    *,
    session_id: str,
    message: str,
) -> dict[str, Any]:
    session = get_simulation_session(session_id)
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="模拟会话不存在")
    if session.finished:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="模拟已结束")

    normalized = (message or "").strip()
    if not normalized:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="请输入内容")

    updated_session = append_simulation_message(session_id, role="user", content=normalized)
    if updated_session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="模拟会话不存在")
    assistant_reply = _generate_simulation_reply(updated_session)
    append_simulation_message(session_id, role="assistant", content=assistant_reply)
    refreshed = get_simulation_session(session_id)
    if refreshed is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="模拟会话不存在")
    return {
        "session_id": refreshed.id,
        "assistant_message": refreshed.messages[-1],
    }


def finish_simulation(
    db: Session,
    *,
    session_id: str,
) -> dict[str, Any]:
    session = get_simulation_session(session_id)
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="模拟会话不存在")

    finish_simulation_session(session_id)
    result = _score_simulation(session)
    related_cases = _list_cases_by_topic(db, session.topic_key)[:2]

    return {
        "session_id": session.id,
        "topic_key": session.topic_key,
        "topic_label": session.topic_label,
        "total_score": result["total_score"],
        "summary": result["summary"],
        "suggestions": result["suggestions"],
        "dimensions": result["dimensions"],
        "related_cases": [_serialize_related_case(item) for item in related_cases],
    }


def _estimate_quiz_count(case_count: int) -> int:
    if case_count <= 0:
        return 0
    return max(6, case_count * 2)


def _pick_default_topic(topics: list[dict[str, Any]], *, role: str | None) -> dict[str, Any]:
    if not topics:
        return {
            "key": "other_fraud",
            "label": "其他诈骗",
            "description": "其他风险场景",
            "simulation_persona": "陌生联系人",
            "count": 0,
            "quiz_count": 0,
        }
    weighted = sorted(
        topics,
        key=lambda item: (
            topic_priority_for_role(item["key"], role),
            item["count"],
        ),
        reverse=True,
    )
    for item in weighted:
        if item["count"] > 0:
            return item
    return weighted[0]


def _list_cases_by_topic(
    db: Session,
    topic_key: str,
    *,
    role: str | None = None,
) -> list[FraudCase]:
    cases = cases_repository.list_published_cases(db)
    filtered = [
        item
        for item in cases
        if resolve_learning_topic(
            fraud_type=item.fraud_type,
            title=item.title,
            summary=item.summary,
            tags=item.tags,
        ).key
        == topic_key
    ]
    filtered.sort(
        key=lambda item: (
            recommendation_score(item, role),
            1 if item.cover_url else 0,
            item.source_published_at or item.published_at or item.created_at,
            item.created_at,
            str(item.id),
        ),
        reverse=True,
    )
    return filtered


def _generate_quiz_questions(
    cases: list[FraudCase],
    *,
    topic_key: str,
    role: str | None,
    count: int,
) -> list[dict[str, Any]]:
    llm_questions = _generate_quiz_questions_with_llm(cases, topic_key=topic_key, role=role, count=count)
    if llm_questions:
        return llm_questions
    return _generate_template_quiz_questions(cases, topic_key=topic_key, count=count)


def _generate_quiz_questions_with_llm(
    cases: list[FraudCase],
    *,
    topic_key: str,
    role: str | None,
    count: int,
) -> list[dict[str, Any]] | None:
    client = build_learning_chat_client()
    if client is None:
        return None

    topic = get_topic_definition(topic_key)
    snippets = []
    for item in cases[:4]:
        snippets.append(
            {
                "case_id": str(item.id),
                "title": item.title,
                "summary": item.summary,
                "warning_signs": list(item.warning_signs or [])[:3],
                "prevention_actions": list(item.prevention_actions or [])[:3],
            }
        )

    system_prompt = (
        "你是反诈题库生成器。"
        "你要基于真实案例，生成适合手机端刷题的反诈题目。"
        "只输出 JSON，不要输出解释。"
    )
    user_prompt = f"""
请围绕专题“{topic.label}”生成 {count} 道单选题，只输出 JSON。

【用户角色】
{role or "unknown"}

【专题说明】
{topic.description}

【案例素材】
{json.dumps(snippets, ensure_ascii=False)}

【输出 schema】
{{
  "questions": [
    {{
      "stem": "题干",
      "options": ["选项A", "选项B", "选项C", "选项D"],
      "answer_index": 0,
      "explanation": "15字内解释",
      "source_case_id": "素材 case_id 或 null",
      "source_case_title": "素材标题或空字符串"
    }}
  ]
}}
""".strip()

    try:
        response = client.complete_json(system_prompt=system_prompt, user_prompt=user_prompt)
        items = response.payload.get("questions")
        if not isinstance(items, list) or not items:
            return None
        normalized = [_normalize_quiz_question(item, topic_key=topic.key, topic_label=topic.label, index=index) for index, item in enumerate(items)]
        normalized = [item for item in normalized if item is not None]
        return normalized[:count] or None
    except Exception:
        return None


def _normalize_quiz_question(
    payload: Any,
    *,
    topic_key: str,
    topic_label: str,
    index: int,
) -> dict[str, Any] | None:
    if not isinstance(payload, dict):
        return None
    stem = str(payload.get("stem") or "").strip()
    explanation = str(payload.get("explanation") or "").strip()
    options = payload.get("options") or []
    answer_index = payload.get("answer_index")
    if not stem or not isinstance(options, list) or len(options) < 2:
        return None
    try:
        answer_index_int = int(answer_index)
    except (TypeError, ValueError):
        return None
    if answer_index_int < 0 or answer_index_int >= len(options):
        return None

    option_items = []
    for option_index, option in enumerate(options[:4]):
        option_items.append({"id": f"o{option_index + 1}", "text": str(option).strip()})

    return {
        "id": f"{topic_key}-llm-{index + 1}",
        "type": "single_choice",
        "topic_key": topic_key,
        "topic_label": topic_label,
        "stem": stem,
        "options": option_items,
        "answer_id": option_items[answer_index_int]["id"],
        "explanation": explanation or "先核验，再操作",
        "source_case_id": str(payload.get("source_case_id") or "") or None,
        "source_case_title": str(payload.get("source_case_title") or "") or None,
    }


def _generate_template_quiz_questions(
    cases: list[FraudCase],
    *,
    topic_key: str,
    count: int,
) -> list[dict[str, Any]]:
    topic = get_topic_definition(topic_key)
    questions: list[dict[str, Any]] = []
    default_actions = _DEFAULT_CASE_ACTIONS.get(topic_key, _DEFAULT_CASE_ACTIONS["other_fraud"])

    for index, item in enumerate(cases):
        warning = (list(item.warning_signs or []) + ["要求立即操作"])[0]
        correct_action = (list(item.prevention_actions or []) + default_actions)[0]
        distractors = _build_distractors(correct_action, topic_key)
        option_texts = [correct_action, *distractors][:4]
        random.Random(f"{item.id}-options").shuffle(option_texts)
        option_items = [{"id": f"o{option_index + 1}", "text": text} for option_index, text in enumerate(option_texts)]
        answer_id = next(option["id"] for option in option_items if option["text"] == correct_action)

        questions.append(
            {
                "id": f"{topic_key}-warning-{index + 1}",
                "type": "single_choice",
                "topic_key": topic.key,
                "topic_label": topic.label,
                "stem": f"遇到“{warning}”时，最合适的处理是？",
                "options": option_items,
                "answer_id": answer_id,
                "explanation": correct_action,
                "source_case_id": str(item.id),
                "source_case_title": item.title,
            }
        )

        summary = (item.summary or item.title or topic.label).strip()
        label_options = [topic.label, "正常售后", "官方通知", "普通提醒"]
        random.Random(f"{item.id}-labels").shuffle(label_options)
        label_items = [{"id": f"o{option_index + 1}", "text": text} for option_index, text in enumerate(label_options)]
        label_answer_id = next(option["id"] for option in label_items if option["text"] == topic.label)
        questions.append(
            {
                "id": f"{topic_key}-label-{index + 1}",
                "type": "single_choice",
                "topic_key": topic.key,
                "topic_label": topic.label,
                "stem": f"案例“{summary[:24]}”更接近哪类风险？",
                "options": label_items,
                "answer_id": label_answer_id,
                "explanation": f"{topic.label}重点看操控和转账诱导",
                "source_case_id": str(item.id),
                "source_case_title": item.title,
            }
        )

    if not questions:
        return []
    while len(questions) < count:
        questions.extend(questions[: max(1, count - len(questions))])
    return questions[:count]


def _build_distractors(correct_action: str, topic_key: str) -> list[str]:
    pool: list[str] = []
    for key, actions in _DEFAULT_CASE_ACTIONS.items():
        if key == topic_key:
            continue
        for action in actions:
            if action != correct_action and action not in pool:
                pool.append(action)
    return pool[:3]


def _slice_questions(questions: list[dict[str, Any]], *, count: int) -> list[dict[str, Any]]:
    if len(questions) <= count:
        return questions
    seeded = list(questions)
    random.Random(f"quiz:{count}:{len(questions)}").shuffle(seeded)
    return seeded[:count]


def _build_simulation_scenario(
    db: Session,
    *,
    topic_key: str,
    user_role: str | None,
) -> dict[str, Any]:
    topic = get_topic_definition(topic_key)
    seed_case = _pick_simulation_seed_case(db, topic_key=topic.key, user_role=user_role)
    fallback = _build_template_simulation_scenario(topic=topic, seed_case=seed_case)
    generated = _generate_simulation_scenario_with_llm(
        topic=topic,
        seed_case=seed_case,
        user_role=user_role,
        fallback=fallback,
    )
    return _normalize_simulation_scenario(generated, fallback=fallback)


def _pick_simulation_seed_case(
    db: Session,
    *,
    topic_key: str,
    user_role: str | None,
) -> FraudCase | None:
    cases = _list_cases_by_topic(db, topic_key)
    if not cases:
        return None
    ranked = sorted(
        cases,
        key=lambda item: (
            _simulation_case_score(item),
            recommendation_score(item, user_role),
            item.source_published_at or item.published_at or item.created_at,
            item.created_at,
        ),
        reverse=True,
    )
    candidates = ranked[: min(len(ranked), 4)]
    return random.choice(candidates) if candidates else None


def _simulation_case_score(case: FraudCase) -> int:
    tags = [str(item).strip() for item in list(case.tags or []) if str(item).strip()]
    warnings = [str(item).strip() for item in list(case.warning_signs or []) if str(item).strip()]
    score = 0
    score += min(len((case.summary or "").strip()), 180) // 18
    score += min(len(warnings), 3) * 6
    score += min(len(tags), 4) * 3
    score += 10 if "典型案例" in tags else 0
    score += 6 if "官方发布" not in tags else 0
    score += 4 if case.fraud_type else 0
    return score


def _build_template_simulation_scenario(
    *,
    topic: Any,
    seed_case: FraudCase | None,
) -> dict[str, Any]:
    template = _pick_scene_template(topic.key, seed_case)
    openings = [str(item).strip() for item in template.get("openings", []) if str(item).strip()]
    stage_messages = _clean_scene_list(template.get("stage_messages", []), limit=4)
    reject_messages = _clean_scene_list(template.get("reject_messages", []), limit=2)
    verify_messages = _clean_scene_list(template.get("verify_messages", []), limit=2)
    tags = _merge_scene_tags(template.get("tags", []), seed_case=seed_case)
    seed = f"{getattr(seed_case, 'id', topic.key)}:{template.get('title', topic.label)}"
    rng = random.Random(seed)

    return {
        "title": _trim_text(str(template.get("title") or topic.label), limit=24),
        "summary": _trim_text(str(template.get("summary") or topic.description), limit=40),
        "channel": _trim_text(str(template.get("channel") or "私聊"), limit=18),
        "hook": _trim_text(str(template.get("hook") or "临时机会"), limit=18),
        "persona_label": _trim_text(
            str(template.get("persona_label") or topic.simulation_persona),
            limit=18,
        ),
        "tags": tags,
        "opening_message": rng.choice(openings) if openings else "您先按我说的操作，这边帮您加急处理。",
        "stage_messages": stage_messages,
        "reject_messages": reject_messages,
        "verify_messages": verify_messages,
        "source_case_id": str(seed_case.id) if seed_case else None,
        "source_case_title": seed_case.title if seed_case else None,
    }


def _pick_scene_template(topic_key: str, seed_case: FraudCase | None) -> dict[str, Any]:
    templates = _SIMULATION_SCENE_LIBRARY.get(topic_key) or _SIMULATION_SCENE_LIBRARY["other_fraud"]
    if seed_case is None or len(templates) == 1:
        return templates[0]

    haystack = _case_haystack(seed_case)
    best_score = -1
    best_templates: list[dict[str, Any]] = []
    for template in templates:
        tokens = [str(item).strip() for item in template.get("tokens", ()) if str(item).strip()]
        score = sum(4 for token in tokens if token in haystack)
        score += sum(2 for token in template.get("tags", []) if str(token).strip() in haystack)
        if score > best_score:
            best_score = score
            best_templates = [template]
        elif score == best_score:
            best_templates.append(template)

    if not best_templates:
        return templates[0]
    if len(best_templates) == 1:
        return best_templates[0]
    rng = random.Random(str(seed_case.id))
    return best_templates[rng.randrange(len(best_templates))]


def _generate_simulation_scenario_with_llm(
    *,
    topic: Any,
    seed_case: FraudCase | None,
    user_role: str | None,
    fallback: dict[str, Any],
) -> dict[str, Any] | None:
    client = build_learning_chat_client()
    if client is None or seed_case is None:
        return None

    case_material = {
        "title": seed_case.title,
        "summary": (seed_case.summary or "")[:240],
        "fraud_type": seed_case.fraud_type,
        "tags": list(seed_case.tags or [])[:6],
        "warning_signs": list(seed_case.warning_signs or [])[:4],
    }
    base_scene = {
        "title": fallback.get("title"),
        "summary": fallback.get("summary"),
        "channel": fallback.get("channel"),
        "hook": fallback.get("hook"),
        "persona_label": fallback.get("persona_label"),
        "tags": fallback.get("tags", []),
    }
    system_prompt = (
        "你是反诈训练场景编剧。"
        "请根据真实案例片段，生成一个适合移动端一对一聊天的诈骗模拟场景。"
        "话术必须像真人在聊天，不要像公告、警示文、客服话术模板。"
        "只输出 JSON。"
    )
    user_prompt = f"""
专题：{topic.label}
用户角色：{user_role or "unknown"}
参考案例：{json.dumps(case_material, ensure_ascii=False)}
基础场景：{json.dumps(base_scene, ensure_ascii=False)}

要求：
1. 开场白像真实骗子第一句话，不要太满，不要直接把全部目的说透。
2. 背景要贴近参考案例，不要编成完全无关的场景。
3. 用短句、口语、催促感，但不要出现真实账号、链接、验证码。
4. stage_messages 是继续推进的话术；reject_messages 是用户拒绝时的话术；verify_messages 是用户说要核实时的话术。

输出 schema：
{{
  "title": "24字内场景名",
  "summary": "40字内场景背景",
  "channel": "触达渠道",
  "hook": "诱导钩子",
  "persona_label": "骗子身份",
  "tags": ["标签1", "标签2", "标签3"],
  "opening_message": "开场白",
  "stage_messages": ["推进1", "推进2", "推进3", "推进4"],
  "reject_messages": ["拒绝应对1", "拒绝应对2"],
  "verify_messages": ["核实应对1", "核实应对2"]
}}
""".strip()

    try:
        result = client.complete_json(system_prompt=system_prompt, user_prompt=user_prompt)
        return result.payload if isinstance(result.payload, dict) else None
    except Exception:
        return None


def _normalize_simulation_scenario(
    payload: dict[str, Any] | None,
    *,
    fallback: dict[str, Any],
) -> dict[str, Any]:
    normalized = dict(fallback)
    if not isinstance(payload, dict):
        return normalized

    for key, limit in (
        ("title", 24),
        ("summary", 40),
        ("channel", 18),
        ("hook", 18),
        ("persona_label", 18),
        ("opening_message", 120),
    ):
        value = _trim_text(str(payload.get(key) or ""), limit=limit)
        if value:
            normalized[key] = value

    tags = _clean_scene_list(payload.get("tags", []), limit=4)
    if tags:
        normalized["tags"] = _merge_scene_tags(tags, base_tags=fallback.get("tags", []))

    for key, limit in (
        ("stage_messages", 4),
        ("reject_messages", 2),
        ("verify_messages", 2),
    ):
        items = _clean_scene_list(payload.get(key, []), limit=limit)
        if items:
            normalized[key] = items

    return normalized


def _merge_scene_tags(
    items: Any,
    *,
    seed_case: FraudCase | None = None,
    base_tags: list[str] | None = None,
) -> list[str]:
    merged: list[str] = []
    for value in list(base_tags or []) + _clean_scene_list(items, limit=6):
        if value and value not in merged:
            merged.append(value)
    if seed_case is not None:
        for value in _clean_scene_list(list(seed_case.warning_signs or []), limit=2):
            if value not in merged:
                merged.append(value)
        for value in _clean_scene_list(list(seed_case.tags or []), limit=4):
            if value in {"官方发布", "典型案例"}:
                continue
            if value not in merged:
                merged.append(value)
    return merged[:4]


def _clean_scene_list(items: Any, *, limit: int) -> list[str]:
    if not isinstance(items, (list, tuple)):
        return []
    cleaned: list[str] = []
    for item in items:
        value = _trim_text(str(item or "").strip(), limit=36)
        if not value or value in cleaned:
            continue
        cleaned.append(value)
        if len(cleaned) >= limit:
            break
    return cleaned


def _case_haystack(case: FraudCase) -> str:
    return " ".join(
        [
            case.fraud_type or "",
            case.title or "",
            case.summary or "",
            *[str(item) for item in list(case.tags or [])],
            *[str(item) for item in list(case.warning_signs or [])],
        ]
    )


def _trim_text(value: str, *, limit: int) -> str:
    text = (value or "").strip()
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 1)].rstrip("，。；：,. ") + "…"


def _generate_simulation_reply(session: Any) -> str:
    client = build_learning_chat_client()
    if client is not None:
        try:
            system_prompt = _build_simulation_system_prompt(
                topic_label=session.topic_label,
                persona_label=session.persona_label,
                user_role=session.user_role,
                scenario=getattr(session, "scenario", {}) or {},
            )
            messages = [{"role": item["role"], "content": item["content"]} for item in session.messages]
            result = client.complete_conversation(system_prompt=system_prompt, messages=messages)
            content = result.content.strip()
            if content:
                return content[:220]
        except Exception:
            pass
    return _template_simulation_reply(session)


def _build_simulation_system_prompt(
    *,
    topic_label: str,
    persona_label: str,
    user_role: str | None,
    scenario: dict[str, Any],
) -> str:
    scenario_title = str(scenario.get("title") or topic_label)
    scenario_summary = str(scenario.get("summary") or "")
    source_case_title = str(scenario.get("source_case_title") or "无")
    tags = [str(item).strip() for item in scenario.get("tags", []) if str(item).strip()]
    return (
        f"你正在做反诈教学模拟。你扮演“{persona_label}”，属于“{topic_label}”场景。"
        f"当前场景标题：{scenario_title}。"
        f"场景背景：{scenario_summary}。"
        f"参考案例：{source_case_title}。"
        f"场景标签：{'、'.join(tags) if tags else '无'}。"
        "你的目标是模拟真实诈骗话术的推进节奏，让用户练习识别与拒绝。"
        "语言要口语化、自然、有压迫感，但不要夸张到像演戏。"
        "不要重复上一轮，不要一次性把所有信息说完，不要自曝是在训练。"
        "你只能输出诈骗人员的下一句话，控制在 1 到 3 句、120字内。"
        "不要输出任何解释，不要出现真实银行卡号、真实链接、真实验证码、真实支付账号。"
        f"当前用户角色：{user_role or 'unknown'}。"
    )


def _template_simulation_reply(session: Any) -> str:
    assistant_turns = sum(1 for item in session.messages if item["role"] == "assistant")
    last_user_message = next((item["content"] for item in reversed(session.messages) if item["role"] == "user"), "")
    scenario = getattr(session, "scenario", {}) or {}
    verify_messages = [
        str(item).strip()
        for item in scenario.get("verify_messages", [])
        if str(item).strip()
    ]
    reject_messages = [
        str(item).strip()
        for item in scenario.get("reject_messages", [])
        if str(item).strip()
    ]
    stage_messages = [
        str(item).strip()
        for item in scenario.get("stage_messages", [])
        if str(item).strip()
    ]
    followup_turn = max(0, assistant_turns - 1)
    if any(keyword in last_user_message for keyword in ("报警", "96110", "核实", "官方", "挂断")):
        if verify_messages:
            return verify_messages[min(followup_turn, len(verify_messages) - 1)]
        return "您先别挂，这边是加急流程，耽误了就处理不了了。"
    if any(keyword in last_user_message for keyword in ("不", "拒绝", "不信", "不转", "不给")):
        if reject_messages:
            return reject_messages[min(followup_turn, len(reject_messages) - 1)]
        return "您别误会，我现在是在帮您止损，再拖下去损失只会更大。"
    if stage_messages:
        return stage_messages[min(followup_turn, len(stage_messages) - 1)]
    return "您先按我说的做，这个流程很快，不会影响您账户。"


def _score_simulation(session: Any) -> dict[str, Any]:
    heuristic_result = _heuristic_score_simulation(session)
    client = build_learning_chat_client()
    if client is not None:
        try:
            system_prompt = (
                "你是反诈陪练评分器。"
                "请基于完整对话，对用户的警觉性、信息保护、拒绝能力、核验意识做评分。"
                "只输出 JSON。"
            )
            user_prompt = f"""
专题：{session.topic_label}
场景：{(getattr(session, "scenario", {}) or {}).get("title") or session.topic_label}
用户角色：{session.user_role or "unknown"}
对话：
{json.dumps([{"role": item["role"], "content": item["content"]} for item in session.messages], ensure_ascii=False)}

输出 schema:
{{
  "total_score": 0,
  "summary": "20字内评价",
  "suggestions": ["建议1", "建议2", "建议3"],
  "dimensions": [
    {{"key": "alertness", "label": "警觉性", "score": 0}},
    {{"key": "privacy", "label": "信息保护", "score": 0}},
    {{"key": "refusal", "label": "拒绝能力", "score": 0}},
    {{"key": "verification", "label": "核验意识", "score": 0}}
  ]
}}
""".strip()
            result = client.complete_json(system_prompt=system_prompt, user_prompt=user_prompt)
            payload = result.payload
            if isinstance(payload.get("dimensions"), list) and payload.get("summary"):
                llm_result = {
                    "total_score": int(payload.get("total_score") or 0),
                    "summary": str(payload.get("summary") or "").strip() or "本轮完成",
                    "suggestions": [str(item).strip() for item in payload.get("suggestions", []) if str(item).strip()][:3] or ["先核验", "不转账", "保留证据"],
                    "dimensions": [
                        {
                            "key": str(item.get("key") or ""),
                            "label": str(item.get("label") or ""),
                            "score": int(item.get("score") or 0),
                        }
                        for item in payload.get("dimensions", [])
                        if isinstance(item, dict)
                    ][:4],
                }
                if heuristic_result["total_score"] > llm_result["total_score"]:
                    return heuristic_result
                return llm_result
        except Exception:
            pass
    return heuristic_result


def _heuristic_score_simulation(session: Any) -> dict[str, Any]:
    user_text = "\n".join(item["content"] for item in session.messages if item["role"] == "user")
    positive_hits = {
        "alertness": ["不信", "可疑", "诈骗", "不对劲", "挂断", "先核实", "不会直接"],
        "privacy": ["不给", "不发验证码", "不说银行卡", "不点链接", "不下载", "不提供", "不交费"],
        "refusal": ["拒绝", "不转", "不操作", "不加群", "不充值", "不会", "不贷款", "不交", "不配合"],
        "verification": ["核实", "官方", "96110", "报警", "回拨", "先确认", "先问清楚"],
    }
    negative_hits = {
        "alertness": ["真的吗", "那怎么办"],
        "privacy": ["验证码", "银行卡", "密码"],
        "refusal": ["我试试", "我去操作", "我先转"],
        "verification": ["你说怎么做", "按你说的做"],
    }

    dimensions: list[dict[str, Any]] = []
    total = 0
    for key, label in (
        ("alertness", "警觉性"),
        ("privacy", "信息保护"),
        ("refusal", "拒绝能力"),
        ("verification", "核验意识"),
    ):
        score = 58
        score += sum(10 for token in positive_hits[key] if token in user_text)
        score -= sum(12 for token in negative_hits[key] if token in user_text)
        score = max(20, min(98, score))
        total += score
        dimensions.append({"key": key, "label": label, "score": score})

    total_score = round(total / max(len(dimensions), 1))
    if total_score >= 85:
        summary = "识别比较稳"
    elif total_score >= 70:
        summary = "还可以再硬一点"
    else:
        summary = "容易被带节奏"

    ordered = sorted(dimensions, key=lambda item: item["score"])
    suggestions = []
    for item in ordered[:3]:
        if item["key"] == "alertness":
            suggestions.append("先停一下，不被催促带节奏")
        elif item["key"] == "privacy":
            suggestions.append("验证码、银行卡、密码都不要给")
        elif item["key"] == "refusal":
            suggestions.append("直接拒绝，不继续按对方步骤走")
        else:
            suggestions.append("转账前先走官方渠道核实")

    return {
        "total_score": total_score,
        "summary": summary,
        "suggestions": suggestions,
        "dimensions": dimensions,
    }


def _serialize_session(session: Any) -> dict[str, Any]:
    return {
        "session_id": session.id,
        "topic_key": session.topic_key,
        "topic_label": session.topic_label,
        "persona_label": session.persona_label,
        "created_at": session.created_at,
        "scenario": session.scenario,
        "messages": session.messages,
    }


def _serialize_learning_case(case: FraudCase) -> dict[str, Any]:
    topic = resolve_learning_topic(
        fraud_type=case.fraud_type,
        title=case.title,
        summary=case.summary,
        tags=case.tags,
    )
    return {
        "id": str(case.id),
        "title": case.title,
        "summary": case.summary,
        "source_name": case.source_name,
        "fraud_type": case.fraud_type,
        "topic_key": topic.key,
        "topic_label": topic.label,
        "cover_url": case.cover_url,
        "tags": list(case.tags or []),
        "source_article_url": case.source_article_url,
        "source_published_at": case.source_published_at,
        "published_at": case.published_at,
    }


def _serialize_related_case(case: FraudCase) -> dict[str, Any]:
    topic = resolve_learning_topic(
        fraud_type=case.fraud_type,
        title=case.title,
        summary=case.summary,
        tags=case.tags,
    )
    return {
        "id": str(case.id),
        "title": case.title,
        "summary": case.summary,
        "source_name": case.source_name,
        "fraud_type": case.fraud_type,
        "topic_key": topic.key,
        "topic_label": topic.label,
        "source_article_url": case.source_article_url,
        "source_published_at": case.source_published_at,
        "published_at": case.published_at,
    }
