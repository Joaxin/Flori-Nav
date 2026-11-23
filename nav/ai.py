# nav/ai.py
"""导航「AI 找网站」管线:OpenAI 兼容接口(配置存 NavAiConfig 单例)。

与 content_engine/ai.py 刻意互相独立(移植规则:nav 不得依赖其他 app 的代码)。
只产出"候选草稿",入库由 views 的导入接口完成——那里会做测活、抓标题图标、去重。
"""
import json
import re
import time

import requests

from .models import NavAiConfig


class AiNotConfigured(Exception):
    """AI 未配置或调用失败,消息直接面向用户展示。"""


def get_config():
    cfg = NavAiConfig.get_solo()
    # API Key 可空(2026-11-19):本地 Ollama / 本机网关通常不验 Key。
    # 云端接口没填 Key 会在第一次请求时拿到 401,错误里已写明检查 API Key。
    if not (cfg.base_url and cfg.model):
        raise AiNotConfigured('AI 尚未配置:点顶栏「🤖 AI 接口」按钮填入接口地址 / 模型名'
                              '(API Key 按接口要求填,本地接口可留空);'
                              '不接接口也能用「无 API 手动模式」。')
    return {'base_url': cfg.base_url.rstrip('/'), 'api_key': cfg.api_key, 'model': cfg.model,
            'model_classify': cfg.model_classify or '', 'model_pet': cfg.model_pet or ''}


# 任务级默认参数(2026-11-19):把原来散在各调用点的硬编码收成一张表。
# 结构化任务要稳(低温、给足超时),陪伴类任务要活(高温、短超时),互不干扰。
TASK_DEFAULTS = {
    'site':     {'temperature': 0.5, 'timeout': 120},   # 找网站:要真实站,别发散
    'classify': {'temperature': 0.2, 'timeout': 150},   # 分类:结果必须稳定可复核
    'pet':      {'temperature': 1.0, 'timeout': 60},    # 桌宠聊天:活泼一点
    'whisper':  {'temperature': 1.0, 'timeout': 30},    # 碎碎念:一句话就走
    'repair':   {'temperature': 0.0, 'timeout': 90},    # 格式修复:只准照抄结构
    'chat':     {'temperature': 0.6, 'timeout': 90},
}
NAV_AI_LOG_KEEP = 50        # 保留最近多少条调用记录


def _task_opts(task, temperature=None, timeout=None):
    base = TASK_DEFAULTS.get(task or 'chat', TASK_DEFAULTS['chat'])
    return (base['temperature'] if temperature is None else temperature,
            base['timeout'] if timeout is None else timeout)


def resolve_model(task=None, override=None, cfg=None):
    """按任务选模型:显式 override > 任务专属模型 > 默认模型。纯函数,便于测试。"""
    if override and str(override).strip():
        return str(override).strip()
    cfg = cfg or get_config()
    key = 'model_classify' if task == 'classify' else ('model_pet' if task in ('pet', 'whisper') else '')
    if key:
        val = str(cfg.get(key) or '').strip()
        if val:
            return val
    return str(cfg.get('model') or '').strip()


def log_call(task, model, ok, elapsed_ms=None, http_status=None, message=''):
    """记一条调用摘要(环形保留)。任何异常都吞掉:日志是辅助,不能反过来搞挂请求。"""
    try:
        from .models import NavAiCallLog
        NavAiCallLog.objects.create(
            task=str(task or 'chat')[:24], model=str(model or '')[:100], ok=bool(ok),
            elapsed_ms=(int(elapsed_ms) if isinstance(elapsed_ms, (int, float)) and elapsed_ms >= 0 else None),
            http_status=http_status, message=str(message or '')[:200])
        stale = list(NavAiCallLog.objects.order_by('-id').values_list('id', flat=True)[NAV_AI_LOG_KEEP:NAV_AI_LOG_KEEP + 20])
        if stale:
            NavAiCallLog.objects.filter(id__in=stale).delete()
    except Exception:   # 含 SimpleTestCase 禁用数据库的情况:静默跳过
        pass


def _message_meta(body):
    """从 OpenAI 兼容返回里取正文和推理过程；不同模型字段名可能是 reasoning_content/reasoning。"""
    choice = body['choices'][0]
    msg_obj = choice.get('message') if isinstance(choice, dict) else {}
    msg_obj = msg_obj if isinstance(msg_obj, dict) else {}
    content = str(msg_obj.get('content') or '').strip()
    reasoning = str(msg_obj.get('reasoning_content') or msg_obj.get('reasoning') or '').strip()
    return {'content': content, 'reasoning': reasoning}


_RETRY_STATUS = (429, 500, 502, 503, 504)


def chat_with_meta(messages, temperature=None, timeout=None, task='chat', model=None):
    """调一次 chat,返回正文/推理/模型名/耗时。

    task 决定默认 temperature 与超时,并决定模型覆盖(分类、桌宠可单独选模型)。
    429 / 5xx 这类网关瞬时波动重试一次(短退避);网络异常和 4xx 不重试 ——
    重试只会把同一个错误再等一遍。
    """
    cfg = get_config()
    temperature, timeout = _task_opts(task, temperature, timeout)
    used_model = resolve_model(task=task, override=model, cfg=cfg)
    started = time.monotonic()
    headers = {'Content-Type': 'application/json'}
    if cfg.get('api_key'):   # 本地 Ollama / 本机网关不验 Key,空 Key 别发 'Bearer '(有的网关会拒)
        headers['Authorization'] = f"Bearer {cfg['api_key']}"
    resp = None
    for attempt in range(2):
        try:
            resp = requests.post(
                f"{cfg['base_url']}/chat/completions",
                headers=headers,
                json={'model': used_model, 'messages': messages, 'temperature': temperature},
                timeout=timeout)
        except requests.RequestException as exc:
            elapsed = int((time.monotonic() - started) * 1000)
            log_call(task, used_model, False, elapsed, None, f'连接失败:{exc}')
            raise AiNotConfigured(f'AI 接口连接失败（模型 {used_model} · {cfg["base_url"]}）:{exc}') from exc
        if resp.status_code == 200 or resp.status_code not in _RETRY_STATUS:
            break
        if attempt == 0:
            time.sleep(0.4)      # 只给瞬时波动留一点喘息,不放大等待
    if resp.status_code != 200:
        elapsed = int((time.monotonic() - started) * 1000)
        # 把「实际用的是哪个模型」写进错误里:换模型只填了输入框没保存时,
        # 用户只会看到 429,根本想不到后端还在用旧模型(2026-11-18 反馈)。
        log_call(task, used_model, False, elapsed, resp.status_code, resp.text[:200])
        raise AiNotConfigured(f'AI 接口返回 {resp.status_code}（当前模型 {used_model}）:{resp.text[:200]}')
    try:
        meta = _message_meta(resp.json())
    except (KeyError, ValueError) as exc:
        elapsed = int((time.monotonic() - started) * 1000)
        log_call(task, used_model, False, elapsed, resp.status_code, f'返回格式异常:{exc}')
        raise AiNotConfigured(f'AI 接口返回格式异常:{str(exc)}') from exc
    if not meta['content'] and not meta['reasoning']:
        elapsed = int((time.monotonic() - started) * 1000)
        log_call(task, used_model, False, elapsed, resp.status_code, '返回内容为空')
        raise AiNotConfigured('AI 接口返回内容为空')
    meta['model'] = used_model
    meta['elapsed_ms'] = int((time.monotonic() - started) * 1000)
    log_call(task, used_model, True, meta['elapsed_ms'], 200, 'ok')   # 成功不存正文:日志只留摘要
    return meta


def chat(messages, temperature=None, timeout=None, task='chat', model=None, meta_out=None):
    """纯文本返回;meta_out 传入 dict 时把本次模型/耗时/推理回写到里面(给需要展示元信息的调用方)。"""
    meta = chat_with_meta(messages, temperature=temperature, timeout=timeout,
                          task=task, model=model)
    if meta_out is not None:
        meta_out.clear()
        meta_out.update(meta)
    return meta['content']


def chat_json(messages, parse, task='chat', temperature=None, timeout=None, model=None,
              meta_out=None):
    """结构化任务:解析失败时把原回复 + 错误原因回传给模型,只修一次格式。

    模型偶尔会在 JSON 前后夹带解释、或漏掉个别字段;整批丢掉太浪费(一次调用可能
    花掉十几秒),所以给它一次「只修格式」的机会。仍失败才把第一次的错误抛给用户。
    meta_out:传 dict 时回写本次模型/总耗时/是否触发过修复,供前端标注。
    """
    temperature, timeout = _task_opts(task, temperature, timeout)
    raw = chat(messages, temperature=temperature, timeout=timeout, task=task, model=model,
               meta_out=meta_out)
    try:
        return parse(raw)
    except (ValueError, AiNotConfigured) as exc:
        first_error = exc
    repair_ask = ('上一次回复无法解析：' + str(first_error)[:150] + '。\n'
                  '请只输出一个 JSON 数组，不要任何解释文字，不要 ```json 代码围栏，'
                  '字段与类型必须与上面要求完全一致。')
    repair_messages = list(messages) + [
        {'role': 'assistant', 'content': str(raw)[:3000]},
        {'role': 'user', 'content': repair_ask},
    ]
    repair_temp, repair_timeout = _task_opts('repair')
    repair_meta = {}
    raw2 = chat(repair_messages, temperature=repair_temp, timeout=repair_timeout,
                task=(str(task) + '_fix')[:24], model=model, meta_out=repair_meta)
    if meta_out is not None:   # 修复那一次也花时间,总耗时要算进去;模型名与首次保持一致
        first_ms = meta_out.get('elapsed_ms') or 0
        meta_out['elapsed_ms'] = int(first_ms + (repair_meta.get('elapsed_ms') or 0))
        meta_out['repaired'] = True
    try:
        return parse(raw2)
    except (ValueError, AiNotConfigured):
        raise first_error


def extract_json_array(text):
    text = re.sub(r'```(?:json)?', '', text or '').strip()
    start, end = text.find('['), text.rfind(']')
    if start == -1 or end == -1 or end <= start:
        raise ValueError('回复中没有 JSON 数组')
    return json.loads(text[start:end + 1])


# 人设说明(2026-11-18):旧版预设了行业身份,容易让候选系统性偏向某一类站点;
# 改为通用选站编辑,领域由用户当次的场景描述(scene)决定,人设里不再预设行业。
SYSTEM_PROMPT = (
    '你是导航站的选站编辑,熟悉各类互联网站点(AI 工具/开发者工具/设计素材/学习文档/'
    '效率服务/资讯社区等),按用户给定的分类和场景推荐真实存在、长期稳定、业内常用的网站。\n'
    '硬性要求:\n'
    '1. 只推荐你非常确定真实存在的网站;url 填该站点真实的首页地址(https:// 开头,'
    '到域名或一级目录为止),多域名/多分站的用主域名;绝不编造、绝不猜测域名;\n'
    '2. 宁缺毋滥:不确定的站不要输出,输出条数可以少于用户要的条数;\n'
    '3. description 用中文一句话(≤40 字)说明"它是干什么的、对访客有什么用";\n'
    '4. name 用站点的通用叫法(中文或英文名,不用完整域名,除非没有更好叫法);\n'
    '5. subcat 优先对齐用户给出的已有小分类命名;没有合适的就留空字符串;\n'
    '6. 只输出 JSON 数组,不要输出任何其他文字。'
)


def build_site_prompts(scene, category_name, sub_name='', count=8, existing_sites=None,
                       sub_options=None):
    """构造推荐网站的 (system, user) 提示词。

    API 管线与「无 API 手动模式」(复制提示词到外部 AI)共用同一份构造,
    保证两条路径拿到的提示词完全一致。不调用任何接口。
    sub_options:该分类下已有小分类清单 —— 让模型 subcat 尽量对齐既有命名,别各造一套。"""
    scene = (scene or '').strip()
    if not scene and not sub_name:
        raise AiNotConfigured('请先描述需求(例如:免费的设计素材站、学习文档站)。')
    count = max(1, min(int(count or 8), 15))
    existing = '\n'.join(f"- {s.get('name', '')} | {s.get('url', '')}"
                         for s in (existing_sites or [])[:50]) or '(暂无)'
    sub_line = '、'.join(str(s).strip() for s in (sub_options or []) if str(s).strip()) or '(暂无)'
    user_prompt = (
        f'导航大类:{category_name}\n'
        f'小分类:{sub_name or "(未指定)"}\n'
        f'场景与要求:{scene or "(按分类补齐常用站点)"}\n'
        f'推荐条数:{count}(可以少于这个数:不确定的站不要给,宁缺毋滥)\n'
        f'该分类下已有的站点(不要重复推荐,也不要推荐同一域名的不同页面):\n{existing}\n'
        f'该分类下已有的小分类命名(subcat 尽量对齐):{sub_line}\n\n'
        '输出 JSON 数组,每个元素形如:\n'
        '{"name": "站点通用名", "url": "https://真实首页地址", '
        '"description": "中文一句话简介", "subcat": "适合的小分类名(≤10字,拿不准就留空)"}'
    )
    return SYSTEM_PROMPT, user_prompt


def parse_site_drafts(raw, count=8):
    """解析并清洗 AI 回复(容忍 ```json 围栏和前后废话),返回候选草稿。

    API 返回与手动模式粘贴回来的内容走同一个解析;name/url 缺一不可。"""
    drafts = extract_json_array(raw)
    cleaned = []
    for d in drafts[:count]:
        if not isinstance(d, dict):
            continue
        name = str(d.get('name') or '').strip()[:100]
        url = str(d.get('url') or '').strip()
        if not name or not re.match(r'^https?://', url):
            continue
        cleaned.append({'name': name,
                        'url': url[:300],
                        'description': str(d.get('description') or '').strip()[:200],
                        'subcat': str(d.get('subcat') or '').strip()[:50]})
    if not cleaned:
        raise AiNotConfigured('AI 返回的候选为空或格式不符,请调整描述后重试。')
    return cleaned


def generate_site_drafts(scene, category_name, sub_name='', count=8, existing_sites=None,
                         sub_options=None, meta_out=None):
    """按分类/场景生成网站候选草稿。existing_sites:[{name, url}],用于避免重复推荐。

    meta_out:传 dict 时回写本次模型/耗时(前端在候选列表上标注「本次：模型 · 6.4s」)。
    """
    system_prompt, user_prompt = build_site_prompts(
        scene, category_name, sub_name=sub_name, count=count,
        existing_sites=existing_sites, sub_options=sub_options)
    return chat_json([{'role': 'system', 'content': system_prompt},
                      {'role': 'user', 'content': user_prompt}],
                     lambda raw: parse_site_drafts(raw, count), task='site',
                     meta_out=meta_out)


# ===== AI 分类(给已有站点重判大类/小分类) =====
# 与「AI 找站」相反:这个不造新站,只给库里已有的站重新归类。
# 两条路径(接口 / 无 API 手动)共用同一份提示词构造,复制出去的效果和接口一致。

# 标签受控词表的种子(2026-11-18):只收「跨分类的属性维度」——获取成本/可达性。
# 库里词表薄时(比如刚导入书签,一条标签都没有)模型才有得选;加新词 = 扩这份白名单,
# 宁少勿滥 —— 每个词都必须对应一个真实的筛选场景,自由造词会让标签系统碎片化
CLASSIFY_TAG_SEED = ('免费', '开源', '需代理', '免登录', '需订阅')

CLASSIFY_SYSTEM_PROMPT = (
    '你是导航站的分类编辑。用户会给一批已有站点(名称、网址、现在的分类),'
    '请判断每个站点最合适的大类和小分类。\n'
    '硬性要求:\n'
    '1. 优先复用用户给出的大类清单;清单里确实没有合适的才新建,新大类要短(≤8 字)、通用、'
    '能装下多个同类站点,别为单个站造分类;\n'
    '2. 小分类 ≤10 字,同一大类下命名保持一致(同类东西用同一个词);拿不准就留空字符串;\n'
    '3. 同类服务必须归到同一个分类:同域名、同产品线、同用途的站点不要拆开,更不要一条一个分类;\n'
    '4. 判断依据是"这个站是干什么用的",不是名字里碰巧出现的字;\n'
    '5. 标签只描述「跨分类的属性」——获取成本(免费/需订阅)、可达性(需代理/免登录)、'
    '能力(多模态/长文本/语音/编程);不要描述主题,主题交给分类,更不要重复分类名;\n'
    '6. 标签只能从用户给出的标签词表里选,词表里没有合适的就输出空数组 —— 宁缺毋滥,'
    '禁止自造词(自造词会让标签系统碎片化);每条最多 3 个;\n'
    '7. 只输出 JSON 数组,不要任何解释文字。'
)


def build_classify_prompts(items, categories, subs_map=None, tags=None, max_subs_per_cat=8):
    """构造「给已有站点重判分类 + 打标签」的 (system, user) 提示词(不调用接口)。

    items: [{'name','url','category','tags'}];categories/subs_map/tags: 库里现成的
    分类与标签词表 —— 喂给模型是为了让它复用命名,而不是每批各造一套。
    """
    subs_map = subs_map or {}
    cats = [str(c).strip() for c in (categories or []) if str(c).strip()]
    cat_line = ' / '.join(cats) or '(暂无)'
    sub_lines = []
    for c in cats[:40]:
        subs = [str(s).strip() for s in (subs_map.get(c) or []) if str(s).strip()][:max_subs_per_cat]
        if subs:
            sub_lines.append(f'- {c}:{"、".join(subs)}')
    sub_block = '\n'.join(sub_lines) or '(暂无)'
    # 受控词表(2026-11-18):库里已有标签在前,种子白名单补后 —— 封闭词表,
    # 模型只能从中选;词表薄的书签库(往往一条标签都没有)也有固定维度可选
    vocab, seen = [], set()
    for t in list(tags or []) + list(CLASSIFY_TAG_SEED):
        t = str(t).strip()
        if t and t not in seen:
            seen.add(t)
            vocab.append(t)
    tag_line = '、'.join(vocab) or '(暂无)'
    rows = []
    for i, it in enumerate(items, 1):
        name = str(it.get('name') or '').strip()[:60]
        url = str(it.get('url') or '').strip()[:120]
        cur = str(it.get('category') or '').strip()[:30] or '(未分类)'
        old_tags = '、'.join(str(t).strip() for t in (it.get('tags') or [])
                             if str(t).strip()) or '无'
        # 简介是判"这个站干什么用的"最直接的证据(2026-11-19):只给名字和网址时,
        # 模型容易按名字里的字猜分类(比如把「豆包」归到食品);库里已有的简介免费拿来用
        desc = str(it.get('description') or '').strip()[:80] or '无'
        rows.append(f'{i} | {name} | {url} | 现分类:{cur} | 现标签:{old_tags} | 简介:{desc}')
    user_prompt = (
        f'可用的大类(优先复用):{cat_line}\n'
        f'各大类下已有小分类(命名尽量对齐):\n{sub_block}\n'
        f'标签词表(封闭,只能从中选,禁止自造词;没有合适的就输出空数组):{tag_line}\n\n'
        f'待分类站点(共 {len(items)} 条,序号 | 名称 | 网址 | 现分类 | 现标签 | 简介):\n'
        + '\n'.join(rows) +
        '\n\n输出 JSON 数组,每条站一个元素:'
        '{"i": 序号(整数), "category": "大类", "subcat": "小分类,可为空字符串", '
        '"tags": ["标签1", "标签2"], "reason": "一句话说明改动原因,分类和标签未变可留空"},'
        'tags 可以为空数组。'
        f'必须覆盖全部 {len(items)} 条,不要遗漏,不要输出解释。'
    )
    return CLASSIFY_SYSTEM_PROMPT, user_prompt


def _clean_classify_tags(raw):
    """标签清洗:字符串数组(容忍 {name});去空白/去重/限长,最多 4 个、单个 10 字。
    (2026-11-18 从 8 收紧到 4:提示词只许 ≤3,解析端留一档余量,超出即模型违规。)"""
    if not isinstance(raw, list):
        return []
    out, seen = [], set()
    for t in raw[:4]:
        if isinstance(t, dict):
            t = t.get('name')
        if not isinstance(t, str):
            continue
        t = t.strip()[:10]
        if t and t not in seen:
            seen.add(t)
            out.append(t)
    return out


def parse_classify_result(raw, count):
    """解析分类回复(容错 ```json 围栏/前后废话),按序号归位;越界和空分类丢弃。"""
    data = extract_json_array(raw)
    out = []
    for d in data:
        if not isinstance(d, dict):
            continue
        try:
            i = int(d.get('i'))
        except (TypeError, ValueError):
            continue
        if i < 1 or i > count:
            continue
        cat = str(d.get('category') or '').strip()[:50]
        if not cat:
            continue
        out.append({'i': i, 'category': cat,
                    'subcat': str(d.get('subcat') or '').strip()[:50],
                    'tags': _clean_classify_tags(d.get('tags')),
                    'reason': str(d.get('reason') or '').strip()[:100]})
    if not out:
        raise ValueError('回复里没有可用的分类结果(需要 {"i":序号,"category":"…"} 的 JSON 数组)')
    return out


def classify_sites(items, categories, subs_map=None, tags=None):
    """一次模型调用给一批站点分类 + 打标签。temperature 低:结果要稳定。"""
    system_prompt, user_prompt = build_classify_prompts(items, categories, subs_map, tags)
    return chat_json([{'role': 'system', 'content': system_prompt},
                      {'role': 'user', 'content': user_prompt}],
                     lambda raw: parse_classify_result(raw, len(items)), task='classify')


# ===== 桌宠 AI(移植 dsh-pet:人设 + 时间上下文 + 记忆轮数 + 表情包配图协议) =====

PET_DEFAULT_PERSONA = (
    '你是主人浏览器里的Q版蓝发小女仆(小鲸鱼),会时不时碎碎念一句。'
    '说话要自然随意、短短一句(20字以内),温柔乖巧带点俏皮,说人话不啰嗦,'
    '不要解释你自己,不要提你是AI。'
)

# 与前端 PET_MEMES 同源(nav/static/pet/memes/*.png);给模型看的一句话描述,
# 让它回复结尾可挑一张配图(协议 [图:名称],名称不在池内即丢弃,防幻觉)。
PET_MEME_DESCRIPTIONS = {
    'Ciallo': '打招呼问好', 'token给妈妈保管': '撒娇要零花钱/心疼开销',
    '假如给我三天多模态': '许愿/感慨', '先养着吧': '无奈躺平',
    '厉害了我的鲸': '夸奖佩服', '压力一只大肥鱼': '压力大',
    '可爱': '卖萌', '吃白饭的大肥鱼': '吃白食/摸鱼',
    '吃饱饱摸肚子': '吃饱满足', '哦鲸鲸': '恍然大悟/哦这样',
    '哪来的电脑病毒': '疑惑/警觉', '大师这个区是什么意思': '看不懂请教',
    '大烧货': '激动安利', '大的药来了': '有救了/来了来了',
    '大的要来啦': '期待大事发生', '完蛋了把黄油删了': '完蛋了慌张',
    '就一碗': '知足/就这点', '就骚了怎么滴吧': '得意俏皮',
    '我不更新你们用什么': '傲娇', '死掉了': '累瘫/没电了',
    '深度睡眠': '想睡/困', '电死你': '假装凶', '要不直接骂他': '生气想骂人',
    '誓死践行开源精神': '认真承诺', '除了调情没啥用': '吐槽',
    '鱼片有资源吗': '想要资源', '黎曼猜想没证明喵': '卖萌敷衍',
}


def pet_time_context():
    """时间背景行(dsh-pet time-context 思路):日期/星期/时段,给模型当下感。"""
    from datetime import datetime
    now = datetime.now()
    hour = now.hour
    if 5 <= hour < 9:
        period = '清晨'
    elif 9 <= hour < 12:
        period = '上午'
    elif 12 <= hour < 14:
        period = '中午'
    elif 14 <= hour < 18:
        period = '下午'
    elif 18 <= hour < 23:
        period = '晚上'
    else:
        period = '深夜'
    week = '星期' + '一二三四五六日'[now.weekday()]
    return f'现在是{now.year}年{now.month}月{now.day}日 {week} {period}。'


def build_pet_messages(text, persona='', memory=None):
    """拼桌宠对话消息。memory: [{'role','content'}...](已截好轮数的历史)。"""
    cfg = NavAiConfig.get_solo()
    persona_text = (persona or cfg.pet_persona or PET_DEFAULT_PERSONA).strip()
    system = (persona_text + f'\n你的名字是"小鲸鱼"。\n' + pet_time_context())
    messages = [{'role': 'system', 'content': system}]
    for m in (memory or [])[-40:]:
        if isinstance(m, dict) and m.get('role') in ('user', 'assistant') and m.get('content'):
            messages.append({'role': m['role'], 'content': str(m['content'])[:2000]})
    messages.append({'role': 'user', 'content': text[:4000]})
    return messages


def pet_meme_line():
    """把表情包清单(名称+描述)拼成给模型的配图指令段落。"""
    items = '\n'.join(f'- {k}:{v}' for k, v in PET_MEME_DESCRIPTIONS.items())
    return ('可用的表情包(名称:描述):\n' + items + '\n'
            '回复结尾可选附一张表情包来配合情绪:如果哪张很贴切,就在回复最后'
            '另起一行写 [图:名称](名称必须原样取自上面清单,不贴切就不写)。')


_MEME_TAG_RE = re.compile(r'\[图[:：]\s*([^\]\n]+?)\s*\]\s*$')


def split_pet_meme(reply):
    """拆 [图:名称] 配图标记:命中池内才采纳(防幻觉),否则返回纯文本。"""
    text = (reply or '').strip()
    m = _MEME_TAG_RE.search(text)
    if not m:
        return text, ''
    name = m.group(1).strip()
    if name not in PET_MEME_DESCRIPTIONS:
        return text, ''
    return text[:m.start()].strip(), name


def pet_memory_append(memory, user_text, reply_text, rounds=5):
    """追加一轮对话并按轮数截断([图:] 标记不进历史)。"""
    keep = max(1, int(rounds or 5)) * 2
    memory = [m for m in (memory or []) if isinstance(m, dict)]
    memory.append({'role': 'user', 'content': user_text[:2000]})
    memory.append({'role': 'assistant', 'content': reply_text[:2000]})
    return memory[-keep:]


def pet_whisper_generate():
    """AI 碎碎念:一句日常碎碎念 + 可选配图(温度 1,短输出)。"""
    cfg = get_config()
    persona = NavAiConfig.get_solo().pet_persona.strip()
    system = (persona or PET_DEFAULT_PERSONA) + '\n你的名字是"小鲸鱼"。\n' + pet_time_context()
    user = '随便说一句日常碎碎念,一句就好,20字以内。\n\n' + pet_meme_line()
    raw = chat([{'role': 'system', 'content': system},
                {'role': 'user', 'content': user}], task='whisper')
    text, meme = split_pet_meme(raw)
    return text[:100], meme


def deepseek_balance():
    """查 DeepSeek 账户余额(GET {base_url}/user/balance)。仅官方接口支持。"""
    cfg = get_config()
    resp = requests.get(f"{cfg['base_url']}/user/balance",
                        headers={'Authorization': f"Bearer {cfg['api_key']}"},
                        timeout=15)
    if resp.status_code != 200:
        raise AiNotConfigured(f'余额查询返回 {resp.status_code}:{resp.text[:200]}')
    data = resp.json()
    infos = data.get('balance_infos') or []
    total = ''
    for it in infos:
        if it.get('currency') == 'CNY':
            total = it.get('total_balance', '')
            break
    return {'is_available': bool(data.get('is_available')),
            'total_balance': total,
            'currency': (infos[0].get('currency') if infos else 'CNY'),
            'raw': infos}
