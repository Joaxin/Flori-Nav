# nav/views_nav_quiz.py
"""访客准入答题页(2026-11-25)。

题目和提示来自公开快照(不查库);答案只在数据库里,POST 时才读一次。
答对种 `nav_gate_pass` cookie(30 天),换题/改答案会让它自动失效。

不依赖 Bootstrap/主题:这页要在"整站打不开"的状态下也能独立显示。
"""

import logging

from django.http import HttpResponseRedirect, JsonResponse
from django.shortcuts import render
from django.views.decorators.http import require_http_methods

from config.middleware import (
    NAV_QUIZ_COOKIE, NAV_QUIZ_MAX_AGE,
    _client_ip, public_gate, quiz_pass_token, quiz_rate_limited, record_quiz_fail,
    reset_gate_cache,
)
from .management.commands.export_nav_public import quiz_gate_key
from .models import NavPublicConfig
from .nav_access import nav_is_owner
from .signals import write_public_snapshot
from .views_nav_base import _json_body

logger = logging.getLogger('nav')


def _safe_next(raw):
    """只接受站内绝对路径,挡住 `//evil.com`、`https://evil.com`、`/\\evil.com`。"""
    value = (raw or '').strip()
    if not value.startswith('/') or value.startswith('//') or '\\' in value:
        return '/nav/'
    return value[:500]


@require_http_methods(['GET', 'POST'])
def nav_quiz(request):
    gate = public_gate()
    if not gate.get('enabled'):            # 没开准入门:这页没有存在的意义
        return HttpResponseRedirect('/nav/')
    cfg = NavPublicConfig.safe_current()
    next_url = _safe_next(request.POST.get('next') or request.GET.get('next'))
    lang = request.COOKIES.get('nav_lang') or ''
    error = ''
    status = 200
    if request.method == 'POST':
        answer = (request.POST.get('answer') or '').strip()
        ip = _client_ip(request)
        if quiz_rate_limited(ip):
            error = 'Too many attempts. Come back in a minute.' if lang == 'en' \
                else '试太多次了,过一分钟再来。'
            status = 429
        elif cfg.accepts(answer):
            response = HttpResponseRedirect(next_url)
            response.set_cookie(NAV_QUIZ_COOKIE,
                                quiz_pass_token(quiz_gate_key(cfg.quiz_question, cfg.quiz_answers)),
                                max_age=NAV_QUIZ_MAX_AGE, httponly=True,
                                samesite='Lax', secure=request.is_secure())
            return response
        else:
            record_quiz_fail(ip)
            if answer:
                error = 'Not quite. Think again?' if lang == 'en' else '不对,再想想?'
            else:
                error = 'Type your answer first.' if lang == 'en' else '先把答案填上。'
    return render(request, 'nav/nav_quiz.html', {
        'question': gate.get('question') or '',
        'hint': gate.get('hint') or '',
        'next': next_url,
        'error': error,
        'nav_lang': lang,
    }, status=status)


@require_http_methods(['GET', 'POST'])
def api_nav_quiz_config(request):
    """主人后台读写访客准入门:开关 / 题目 / 可接受答案(每行一个) / 提示。

    GET 回显当前配置(含答案,只有主人看得到);POST 保存并立即重写公开快照,
    不用等下一次保存站点就生效。答案不进快照,只留数据库。
    """
    if not nav_is_owner(request):
        return JsonResponse({'status': 'error', 'message': '未授权'}, status=403)
    try:
        cfg = NavPublicConfig.current()
    except Exception as exc:
        logger.warning('读取访客准入配置失败:%s', exc)
        return JsonResponse({'status': 'error',
                             'message': '数据库还没迁移(缺 NavPublicConfig 的准入门列):'
                                        '请先执行 python manage.py migrate'}, status=500)
    if request.method == 'GET':
        return JsonResponse({'status': 'success', 'config': {
            'enabled': cfg.gate_enabled,
            'question': cfg.quiz_question,
            'answers': cfg.quiz_answers,
            'hint': cfg.quiz_hint,
            'ready': cfg.gate_ready(),
        }})
    data, err = _json_body(request)
    if err:
        return err
    enabled = bool(data.get('enabled'))
    question = (data.get('question') or '').strip()[:200]
    answers = (data.get('answers') or '').strip()[:2000]
    hint = (data.get('hint') or '').strip()[:200]
    if enabled and not (question and [a for a in answers.splitlines() if a.strip()]):
        return JsonResponse({'status': 'error',
                             'message': '启用前请先把题目和至少一个答案填上'}, status=400)
    cfg.gate_enabled = enabled
    cfg.quiz_question = question
    cfg.quiz_answers = answers
    cfg.quiz_hint = hint
    cfg.save()
    reset_gate_cache()          # 本实例立即生效;其它实例最多 2 分钟(缓存过期)跟上
    write_public_snapshot(force=True)
    return JsonResponse({'status': 'success', 'enabled': cfg.gate_ready()})
