# nav/models.py
from django.db import models
from django.utils.translation import gettext_lazy as _


class NavSite(models.Model):
    """网址导航条目(通用模块)。内置站点由 nav_data.DEFAULT_SITES 种子导入,可增删和 JSON 导入导出。
    children 为子网页/子站点列表:[{name, url}],点击主站时弹窗选择。
    alternates 为备用网址列表:[{name, url}],同一站点的镜像/资源/备份地址。"""
    name = models.CharField(max_length=100, verbose_name=_("网站名称"))
    url = models.URLField(max_length=300, unique=True, verbose_name=_("网址"))
    category = models.CharField(max_length=50, db_index=True, verbose_name=_("分类"))
    subcat = models.CharField(max_length=50, blank=True, db_index=True, verbose_name=_("小分类"))
    description = models.CharField(max_length=200, blank=True, verbose_name=_("简介"))
    site_title = models.CharField(max_length=200, blank=True, verbose_name=_("页面标题"))
    favicon = models.URLField(max_length=300, blank=True, verbose_name=_("站点图标"))
    icon_text = models.CharField(max_length=8, blank=True, verbose_name=_("自定义图标文字"))
    icon_color = models.CharField(max_length=9, blank=True, verbose_name=_("自定义图标底色"))
    icon_size = models.PositiveSmallIntegerField(default=0, verbose_name=_("自定义图标字号(0=默认)"))
    children = models.JSONField(default=list, blank=True, verbose_name=_("子网页"))
    alternates = models.JSONField(default=list, blank=True, verbose_name=_("备用网址"))
    tags = models.JSONField(default=list, blank=True, verbose_name=_("标签"))
    order = models.IntegerField(null=True, blank=True, default=None, verbose_name=_("拖拽排序"))
    is_builtin = models.BooleanField(default=False, verbose_name=_("内置站点"))
    click_count = models.PositiveIntegerField(default=0, verbose_name=_("点击次数"))
    last_check_at = models.DateTimeField(null=True, blank=True, default=None,
                                         verbose_name=_("上次体检时间"))
    last_check_ok = models.BooleanField(null=True, blank=True, default=None,
                                       verbose_name=_("上次体检可否打开"))
    last_check_note = models.CharField(max_length=60, blank=True,
                                       verbose_name=_("上次体检结果说明"))
    # 状态点/悬停详情用(2026-11-10):测活时顺手记 HTTP 码与耗时,
    # 卡片上就不用在打开页面时再探一遍;老记录为空 = 还没测过。
    last_check_code = models.PositiveSmallIntegerField(null=True, blank=True, default=None,
                                                       verbose_name=_("上次体检 HTTP 状态码"))
    last_check_ms = models.PositiveIntegerField(null=True, blank=True, default=None,
                                                verbose_name=_("上次体检耗时(毫秒)"))
    # 休眠(2026-10-30):删之前先收起来。主列表不渲染,数据/星标/体检记录全部原样保留,
    # 打开页面时也不发任何请求——纯展示层开关,可唤醒。必须进导出 JSON,否则换机即复活。
    archived_at = models.DateTimeField(null=True, blank=True, default=None,
                                       verbose_name=_("休眠时间(空=正常显示)"))
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name_plural = _("网址导航")
        ordering = ['category', 'name']

    def __str__(self):
        return f"{self.category} - {self.name}"

    @property
    def fav_url(self):
        """卡片图标:抓取到的真实 favicon 优先,否则走 favicon.im 兜底(icon.horse 在本机网络常整段超时,Google s2 国内常不可达,见 fav_url_alt);拿不到主机名返回空。"""
        if self.favicon:
            return self.favicon
        from urllib.parse import urlparse
        host = urlparse(self.url).hostname
        if not host:
            return ''
        return f'https://favicon.im/{host}'

    @property
    def host(self):
        """去掉 www. 的主机名,给「媒体行」布局当副标题用(2026-11-13)。

        列表/大图标这类一行一项的布局需要在站名下面有一行副标题,简介常常是空的,
        主机名则永远有 —— 播放器那一行「歌名 + 歌手」的对应物。
        """
        from urllib.parse import urlparse
        try:
            host = urlparse(self.url or '').hostname or ''
        except ValueError:
            return ''
        return host[4:] if host.startswith('www.') else host

    @property
    def fav_url_alt(self):
        """图标第二来源:Google s2(挂代理时可用),前端 onerror 级联用。"""
        from urllib.parse import urlparse
        host = urlparse(self.url).hostname
        if not host:
            return ''
        return f'https://www.google.com/s2/favicons?domain={host}&sz=32'

    @property
    def pinyin_initial(self):
        """卡片搜索用的拼音首字母串;随页面渲染自动生成,无需手动刷新静态表。"""
        from .pinyin import name_initial
        return name_initial(self.name)

    @property
    def check_failed(self):
        """上次体检明确判为打不开(从未体检过 = None,不算失败,不显示标记)。"""
        return self.last_check_ok is False

    @property
    def check_age_days(self):
        """距上次体检多少天(项目 TIME_ZONE=UTC,直接在模板里渲染时间戳会相差 8 小时,
        所以只算天数差给悬停提示用)。未体检过返回 None。"""
        if not self.last_check_at:
            return None
        from django.utils import timezone
        return max(0, (timezone.now() - self.last_check_at).days)

    @property
    def check_age_text(self):
        """距上次体检多久,写成「2 小时前检测」这种卡片上看得懂的话。

        check_age_days 只有天数(0 天前 / 3 天前),刚测完和昨天测的看起来一样,
        所以悬停提示单独给一份更细的文本。未体检过返回 ''。
        """
        if not self.last_check_at:
            return ''
        from django.utils import timezone
        secs = max(0, int((timezone.now() - self.last_check_at).total_seconds()))
        if secs < 120:
            return '刚刚检测'
        if secs < 3600:
            return f'{secs // 60} 分钟前检测'
        if secs < 86400:
            return f'{secs // 3600} 小时前检测'
        return f'{secs // 86400} 天前检测'

    @property
    def check_tip(self):
        """卡片状态点的悬停提示(第一行结论,第二行时间/状态码/耗时)。

        模板里只写 data-tip="{{ site.check_tip }}",判断都留在模型里 ——
        模板里做 None > 1500 这类比较容易在没测过的站点上炸掉。
        """
        if not self.last_check_at:
            return ''
        if self.check_failed:
            head = '测活异常:上次检测无法访问'
        elif (self.last_check_ms or 0) > 1500:
            head = f'访问偏慢:{self.last_check_ms}ms'
        else:
            head = '访问正常'
        bits = [self.check_age_text]
        if self.last_check_code:
            bits.append(f'HTTP {self.last_check_code}')
        if self.last_check_ms and not self.check_failed:
            bits.append(f'{self.last_check_ms}ms')
        tail = ' · '.join([b for b in bits if b])
        return f'{head}\n{tail}' if tail else head

    @property
    def is_archived(self):
        """是否处于休眠态(只有 archived_at 一个真相来源,别在别处再判一次)。"""
        return self.archived_at is not None


class NavCategory(models.Model):
    """导航分类的自定义显示顺序与显隐(通用模块)。表为空时按内置顺序 + 名称排序兜底。"""
    name = models.CharField(max_length=50, unique=True, verbose_name=_("分类名称"))
    order = models.PositiveIntegerField(default=0, verbose_name=_("排序"))
    hidden = models.BooleanField(default=False, verbose_name=_("已隐藏"))

    class Meta:
        verbose_name_plural = _("导航分类排序")
        ordering = ['order', 'name']

    def __str__(self):
        return f"{self.order} - {self.name}"


class NavPublicConfig(models.Model):
    """游客页内容范围（单例，pk=1）。

    只影响公开快照 `nav-public.json` 的生成，不影响主人页：
    - public：所有未隐藏分类、未休眠站点（历史行为）
    - builtin：只导出 `is_builtin=True` 的内置站点
    """
    SCOPE_PUBLIC = 'public'
    SCOPE_BUILTIN = 'builtin'
    SCOPE_CHOICES = (
        (SCOPE_PUBLIC, '公开（全部未隐藏站点）'),
        (SCOPE_BUILTIN, '仅内置站点'),
    )

    scope = models.CharField('游客页显示范围', max_length=10, choices=SCOPE_CHOICES,
                             default=SCOPE_PUBLIC)
    updated_at = models.DateTimeField('更新时间', auto_now=True)

    class Meta:
        verbose_name_plural = _("游客页公开配置")

    def __str__(self):
        return self.get_scope_display()

    @classmethod
    def current(cls):
        """返回单例行；不存在时按默认 public 创建。"""
        obj, _ = cls.objects.get_or_create(pk=1, defaults={'scope': cls.SCOPE_PUBLIC})
        return obj


class NavTool(models.Model):
    """导航里托管的单文件 HTML 小工具(用户自己上传,本机自用)。依赖 MEDIA_ROOT。"""
    name = models.CharField(max_length=100, verbose_name=_("工具名称"))
    category = models.CharField(max_length=50, default='我的工具', db_index=True, verbose_name=_("分类"))
    description = models.CharField(max_length=200, blank=True, verbose_name=_("简介"))
    favicon = models.CharField(max_length=2000, blank=True, verbose_name=_("图标(绝对 URL 或 data URI)"))
    file = models.FileField(upload_to='nav_tools/', verbose_name=_("HTML 文件"))
    original_filename = models.CharField(max_length=200, blank=True, verbose_name=_("原始文件名"))
    size = models.PositiveIntegerField(default=0, verbose_name=_("字节数"))
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = _("导航小工具")
        ordering = ['category', 'name']

    @property
    def pinyin_initial(self):
        from .pinyin import name_initial
        return name_initial(self.name)

    def __str__(self):
        return f"{self.category} - {self.name}"


class NavAiConfig(models.Model):
    """导航 AI 找网站功能的接口配置(单例,pk=1,OpenAI 兼容)。
    与 content_engine 的 AiConfig 相互独立:按移植规则,nav 不依赖其他 app。
    base_url 形如 https://api.deepseek.com 或 http://127.0.0.1:11434/v1(本地 Ollama)。

    api_key 可空(2026-11-19):本地 Ollama / 本机网关通常不验 Key,强制填 Key 会把
    这类接口挡在门外;云端接口仍然照常填 Key,留空保存时保持原值。
    model_classify / model_pet 是「按任务分配模型」的可选覆盖,空 = 用默认模型。"""
    base_url = models.CharField("接口地址", max_length=300, default='')
    api_key = models.CharField("API Key", max_length=300, default='', blank=True)
    model = models.CharField("模型名", max_length=100, default='')
    model_classify = models.CharField("分类模型(可选)", max_length=100, default='', blank=True)
    model_pet = models.CharField("桌宠模型(可选)", max_length=100, default='', blank=True)
    # 桌宠 AI(移植 dsh-pet):人设/对话记忆。与「AI 找网站」共用同一接口配置。
    pet_persona = models.TextField("桌宠人设", default='', blank=True)
    pet_memory = models.JSONField("桌宠对话记忆", default=list, blank=True)
    pet_memory_rounds = models.PositiveSmallIntegerField("对话记忆轮数", default=5)
    # 最近一次模型探活结果(2026-11-19):失败原因不只在当次提示里,关掉弹窗后还能回看
    last_check_at = models.DateTimeField("最近检测时间", null=True, blank=True, default=None)
    last_check_ok = models.BooleanField("最近检测可用", null=True, blank=True, default=None)
    last_check_ms = models.PositiveIntegerField("最近检测耗时(ms)", null=True, blank=True, default=None)
    last_check_model = models.CharField("最近检测模型", max_length=100, default='', blank=True)
    last_check_message = models.CharField("最近检测说明", max_length=200, default='', blank=True)
    updated_at = models.DateTimeField("更新时间", auto_now=True)

    class Meta:
        verbose_name_plural = _("导航 AI 配置")

    def __str__(self):
        return f"NavAI: {self.model or '未配置'}"

    @classmethod
    def get_solo(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    @classmethod
    def is_configured(cls):
        cfg = cls.get_solo()
        # 只要地址和模型就够了:本地接口不验 Key,没 Key 也应当能聊、能分类
        return bool(cfg.base_url and cfg.model)


class NavAiCallLog(models.Model):
    """最近 AI 调用记录(环形保留最近 NAV_AI_LOG_KEEP 条)。

    排查时最需要回答的是「刚才那一下到底是谁失败了」:接口挂了、模型拒答、
    还是解析失败。只留结构化摘要,不存完整提示词/回复 —— 那些含站点清单,
    体积大且没有必要长期留。
    """
    task = models.CharField("任务", max_length=24, default='chat')
    model = models.CharField("模型", max_length=100, default='', blank=True)
    ok = models.BooleanField("成功", default=True)
    elapsed_ms = models.PositiveIntegerField("耗时(ms)", null=True, blank=True, default=None)
    http_status = models.PositiveSmallIntegerField("HTTP 状态", null=True, blank=True, default=None)
    message = models.CharField("摘要", max_length=200, default='', blank=True)
    created_at = models.DateTimeField("时间", auto_now_add=True, db_index=True)

    class Meta:
        verbose_name_plural = _("AI 调用记录")
        ordering = ('-id',)

    def __str__(self):
        return f"{self.task} · {self.model} · {'ok' if self.ok else 'fail'}"
