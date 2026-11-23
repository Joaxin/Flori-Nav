# nav/nav_data.py
"""Flori-Nav 内置站点种子(项目专属部分)。

首次访问导航页或点「恢复内置」时按 URL upsert 到 NavSite;换站点只改本文件。

设计约束(2026-11-12):
 - **内置尽量少**:只留 10 个最常用的大模型入口,其余交给用户自己导入。
 - **只有一个分类**「内置网站」,不再分二级分类 —— 内置卡片平铺在一个分组里,
   用户导入自己的书签时不会与内置分类撞名,也不会混进内置分组。
 - 不预设行业，也不含 Agent 类工具（用户单独管理）。

快照时间:2026-11。已下线的不再收录 —— 例如 Sora(App 2026-04-26 关停,
API 2026-09-24 下线)。
"""

NAV_BUILTIN_CATEGORY = '内置网站'

DEFAULT_SITES = [
    # --- 国际大模型 ---
    {'name': 'ChatGPT', 'url': 'https://chatgpt.com', 'category': NAV_BUILTIN_CATEGORY,
     'description': 'OpenAI 对话入口,GPT-5 系列 + 深度研究/Agent',
     'tags': ['需代理', '免费', '多模态'],
     'children': [{'name': 'OpenAI 平台', 'url': 'https://platform.openai.com'},
                  {'name': 'Codex', 'url': 'https://platform.openai.com/codex'}]},
    {'name': 'Claude', 'url': 'https://claude.ai', 'category': NAV_BUILTIN_CATEGORY,
     'description': 'Anthropic 对话,当前 Opus 5.5 / Sonnet 5.5',
     'tags': ['需代理', '免费', '编程'],
     'children': [{'name': 'Claude Code', 'url': 'https://claude.com/product/claude-code'},
                  {'name': 'Anthropic 控制台', 'url': 'https://console.anthropic.com'}]},
    {'name': 'Gemini', 'url': 'https://gemini.google.com', 'category': NAV_BUILTIN_CATEGORY,
     'description': 'Google 助手,Gemini 3.1 Pro,整合 Workspace',
     'tags': ['需代理', '订阅', '多模态'],
     'children': [{'name': 'AI Studio', 'url': 'https://aistudio.google.com'},
                  {'name': 'Google Flow', 'url': 'https://flow.google.com'}]},
    {'name': 'Grok', 'url': 'https://grok.com', 'category': NAV_BUILTIN_CATEGORY,
     'description': 'xAI 对话,实时信息与 X 内容联动',
     'tags': ['需代理', '订阅', '长文本'],
     'children': [{'name': 'xAI 控制台', 'url': 'https://console.x.ai'}]},

    # --- 国内大模型(不含百度、不含腾讯) ---
    {'name': 'DeepSeek', 'url': 'https://chat.deepseek.com', 'category': NAV_BUILTIN_CATEGORY,
     'description': '深度求索,DeepSeek V4 系列,推理与代码强',
     'tags': ['国产', '免费', '编程'],
     'children': [{'name': 'DeepSeek 开放平台', 'url': 'https://platform.deepseek.com'}]},
    {'name': '通义千问 Qwen', 'url': 'https://chat.qwen.ai', 'category': NAV_BUILTIN_CATEGORY,
     'description': '阿里 Qwen3.7-Max,长上下文与多模态',
     'tags': ['国产', '免费', '多模态'],
     'children': [{'name': '通义', 'url': 'https://tongyi.aliyun.com'},
                  {'name': '阿里云百炼', 'url': 'https://bailian.console.aliyun.com'}]},
    {'name': '豆包', 'url': 'https://www.doubao.com', 'category': NAV_BUILTIN_CATEGORY,
     'description': '字节豆包,Seed 2.0 系列,中文口语化',
     'tags': ['国产', '免费', '语音'],
     'children': [{'name': '火山方舟', 'url': 'https://console.volcengine.com/ark'}]},
    {'name': '智谱清言 GLM', 'url': 'https://chatglm.cn', 'category': NAV_BUILTIN_CATEGORY,
     'description': '智谱 GLM-5.2,中文写作与智能体',
     'tags': ['国产', '免费', '编程'],
     'children': [{'name': 'Z.ai', 'url': 'https://chat.z.ai'},
                  {'name': '智谱开放平台', 'url': 'https://bigmodel.cn'}]},
    {'name': 'Kimi', 'url': 'https://www.kimi.com', 'category': NAV_BUILTIN_CATEGORY,
     'description': '月之暗面,长文档阅读与资料整理',
     'tags': ['国产', '免费', '长文本'],
     'children': [{'name': 'Moonshot 开放平台', 'url': 'https://platform.moonshot.cn'}]},
    {'name': 'MiniMax', 'url': 'https://www.minimax.io', 'category': NAV_BUILTIN_CATEGORY,
     'description': 'MiniMax 官方站,M 系列模型与语音',
     'tags': ['国产', '免费', '语音'],
     'children': [{'name': '海螺 AI', 'url': 'https://hailuoai.com'}]},
]

# 顶部搜索框的引擎列表:{query} 为占位符,换/加引擎只改这里(纯前端)。
NAV_SEARCH_ENGINES = [
    {'name': 'Google', 'url': 'https://www.google.com/search?q={query}'},
    {'name': 'Bing', 'url': 'https://www.bing.com/search?q={query}'},
    {'name': 'DuckDuckGo', 'url': 'https://duckduckgo.com/?q={query}'},
    {'name': '百度', 'url': 'https://www.baidu.com/s?wd={query}'},
]
