# -*- coding: utf-8 -*-
"""桌宠的零密钥语料源(2026-11-10 接入)。

背景:桌宠对话与碎碎念依赖用户自配的 AI Key(`NavAiConfig`)。没配 Key 时旧流程直接
返回 400「还没接 AI 接口」= 聊天功能形同不存在。这里接三个**免密钥、免注册**的公共源做兜底:

- 青云客聊天   http://api.qingyunke.com/api.php?key=free&appid=0&msg=…
- 思知机器人   https://api.ownthink.com/bot?spoken=…
- 土味情话     https://api.lovelive.tools/api/SweetNothings

设计只做四件事:取文本、清杂讯、限长、失败返回 None。**不重试、不抛异常、不写日志噪音** ——
调用方拿到 None 就静默回落本地语录,绝不能把第三方报错弹进气泡。

实测口径:2026-11-10 18:10 本机(中国大陆出口)逐条 curl 通过;接口随时会变,
超过一两个月建议重测。两个已知坑(来源同上):
- 思知**不能传空 appid**,`appid=''` 也报 `{"status":-1,"message":"appid为空!"}`;
- 思知返回的 `data.type` 已从数字 `5000` 改成字符串 `"text"`,两者都要认;
- 青云客偶发推广句(2026-11-10 实测「去奥龙霸斯淘宝店睇睇啦」),命中 `_PET_AD_MARKERS` 直接丢弃;
- 本机(本地代理出口)`api.ownthink.com` 会偶发被代理断开(重试一次通常就过,见 `_check_sources.py`) —— 思知保留为第二顺位兜底,
  **不要**把它当唯一依靠;青云客与土味情话走 http,不受同一段代理影响。
"""
from .views_nav_base import _NAV_META_UA, logger

import math

import requests

_PET_SRC_TIMEOUT = 3          # 兜底源永远不该让人等:3 秒拿不到就当作没有
_PET_WX_TIMEOUT = 6           # 天气/空气这类富数据放宽到 6 秒(3 秒实测会偶发超时,明日预报整段丢失)
_PET_SRC_MAX_LEN = 500        # 送出去的提问限长,别把整段聊天记录转发给第三方
_PET_REPLY_MAX = 300          # 气泡再长也没人读,顺手截断

_QINGYUNKE_URL = 'http://api.qingyunke.com/api.php'
_OWNTHINK_URL = 'https://api.ownthink.com/bot'
_SWEET_URL = 'https://api.lovelive.tools/api/SweetNothings'

# 青云客是免费语料库,偶尔会回带店铺/加群的推广句(实测 2026-11-10:「去奥龙霸斯淘宝店睇睇啦」)。
# 桌宠嘴里不能出现这种话,命中就直接当没拿到,交给下一个源或本地语录。
_PET_AD_MARKERS = ('淘宝', '天猫', '拼多多', '微店', '店铺', '下单', '加群', '加我',
                   '私聊', '公众号', '微信', 'http://', 'https://', 'www.')


def _looks_like_ad(text):
    low = (text or '').lower()
    return any(m in low for m in _PET_AD_MARKERS)


def _clean(text, limit=_PET_REPLY_MAX):
    """清掉公共接口常见的占位符(青云客的 `{br}` / `{face:xx}`)并限长。"""
    if not isinstance(text, str):
        return ''
    s = (text.replace('{br}', ' ')
             .replace('\r', ' ')
             .strip())
    while '{face' in s:                      # {face:1} 这类占位符整段删掉
        i = s.index('{face')
        j = s.find('}', i)
        if j < 0:
            s = s[:i]
            break
        s = s[:i] + s[j + 1:]
    s = ' '.join(s.split())                  # 折叠连续空白与换行
    return s[:limit].strip()


def _get_json(url, params, timeout=_PET_SRC_TIMEOUT):
    """GET 一个 JSON,任何失败(超时/4xx/非 JSON/网络断)一律 None。"""
    try:
        r = requests.get(url, params=params, timeout=timeout,
                         headers={'User-Agent': _NAV_META_UA})
        if r.status_code != 200:
            return None
        return r.json()
    except (requests.RequestException, ValueError) as exc:
        logger.debug('桌宠兜底源不可用 %s:%s', url, exc)
        return None


def _get_text(url, params=None, timeout=_PET_SRC_TIMEOUT):
    try:
        r = requests.get(url, params=params or {}, timeout=timeout,
                         headers={'User-Agent': _NAV_META_UA})
        if r.status_code != 200:
            return ''
        return r.text or ''
    except requests.RequestException as exc:
        logger.debug('桌宠兜底源不可用 %s:%s', url, exc)
        return ''


def qingyunke_chat(text):
    """青云客:免密钥不限量,中文口语化。失败返回 None。"""
    text = str(text or '').strip()[:_PET_SRC_MAX_LEN]
    if not text:
        return None
    data = _get_json(_QINGYUNKE_URL, {'key': 'free', 'appid': 0, 'msg': text})
    if not isinstance(data, dict) or data.get('result') != 0:
        return None
    reply = _clean(data.get('content'))
    if not reply or _looks_like_ad(reply):
        return None
    return reply


def ownthink_chat(text, appid=''):
    """思知:免费无限量。空 appid 会报错,所以「有值才加参数」。"""
    text = str(text or '').strip()[:_PET_SRC_MAX_LEN]
    if not text:
        return None
    params = {'spoken': text}
    if str(appid or '').strip():
        params['appid'] = str(appid).strip()
    data = _get_json(_OWNTHINK_URL, params)
    if not isinstance(data, dict):
        return None
    payload = data.get('data')
    if not isinstance(payload, dict):
        return None
    if payload.get('type') not in ('text', 5000):     # 老版数字 5000 / 新版字符串 'text'
        return None
    info = payload.get('info') or {}
    return _clean(info.get('text')) or None


def fallback_chat(text):
    """按性价比顺序试兜底聊天源,返回 (回复, 来源)。都不可用 → (None, None)。"""
    reply = qingyunke_chat(text)
    if reply:
        return reply, 'qingyunke'
    reply = ownthink_chat(text)
    if reply:
        return reply, 'ownthink'
    return None, None


def sweet_nothing():
    """土味情话:纯文本接口,可能多行,取第一条有效行。失败返回 None。"""
    raw = _get_text(_SWEET_URL)
    for line in (raw or '').splitlines():
        line = _clean(line)
        if line:
            return line
    return None
_AQ_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality'
_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
_ICIBA_URL = 'http://open.iciba.com/dsapi'

_AQI_STEPS = ((50, '优'), (100, '良'), (150, '轻度'), (200, '中度'), (300, '重度'))


def aqi_label(value):
    """国标分档(0-50 优 / 51-100 良 / 101-150 轻度 / 151-200 中度 / 201-300 重度 / 更高 严重)。"""
    try:
        v = float(value)
    except (TypeError, ValueError):
        return ''
    for cap, name in _AQI_STEPS:
        if v <= cap:
            return name
    return '严重'


def air_quality(lat, lon):
    """空气质量:open-meteo air-quality(免 key,复用天气那套经纬度)。

    不用 WAQI:实测 demo token 对任何城市名都回同一座上海站点(idx 1437),分不清城市。
    """
    data = _get_json(_AQ_URL, {'latitude': lat, 'longitude': lon,
                               'current': 'european_aqi,pm2_5', 'timezone': 'auto'},
                     timeout=_PET_WX_TIMEOUT)
    cur = (data or {}).get('current') or {}
    val = cur.get('european_aqi')
    if not isinstance(val, (int, float)):
        return None
    out = {'value': _half_up(val), 'label': aqi_label(val)}
    pm = cur.get('pm2_5')
    if isinstance(pm, (int, float)):
        out['pm25'] = round(float(pm), 1)
    return out


def daily_forecast(lat, lon):
    """明日预报:同一个 open-meteo 源多要一段 daily。

    不引 sojson 的 7 天:它要中国城市码(得再搬 68KB 映射表),且是单点 http 源;
    欧标这套与实况同源同经纬度,口径一致、失败面更小。
    """
    data = _get_json(_FORECAST_URL, {
        'latitude': lat, 'longitude': lon, 'timezone': 'auto', 'forecast_days': 2,
        'daily': ('weather_code,temperature_2m_max,temperature_2m_min,'
                  'precipitation_probability_max,uv_index_max')},
        timeout=_PET_WX_TIMEOUT)
    daily = (data or {}).get('daily') or {}
    try:
        i = 1                                    # 下标 1 = 明天
        tmax, tmin = daily['temperature_2m_max'][i], daily['temperature_2m_min'][i]
        if not isinstance(tmax, (int, float)) or not isinstance(tmin, (int, float)):
            return None
        rain = (daily.get('precipitation_probability_max') or [None, None])[i]
        uv = (daily.get('uv_index_max') or [None, None])[i]
        return {'date': str(daily.get('time', ['', ''])[i]),
                'code': daily.get('weather_code', [0, 0])[i],
                'tmax': _half_up(tmax), 'tmin': _half_up(tmin),
                'rain': int(rain) if isinstance(rain, (int, float)) else None,
                'uv': round(float(uv), 1) if isinstance(uv, (int, float)) else None}
    except (KeyError, IndexError, TypeError, ValueError) as exc:
        logger.debug('明日预报解析失败:%s', exc)
        return None


def daily_english():
    """每日英语(金山词霸):一条英文 + 中文译文,按天缓存交给调用方。"""
    data = _get_json(_ICIBA_URL, {})
    if not isinstance(data, dict):
        return None
    en = _clean(data.get('content'), limit=200)
    zh = _clean(data.get('note') or data.get('translation'), limit=200)
    return {'en': en, 'zh': zh} if en else None

def _half_up(value):
    """四舍五入成整数。round() 是银行家舍入(0.5 → 0),气温上会差一度,必须自己来。"""
    return int(math.floor(float(value) + 0.5))
