# -*- coding: utf-8 -*-
"""桌宠天气源(2026-11-18):中国气象局 weather.cma.cn 为主,Open-Meteo 兜底。

为什么换源:原先浏览器直连 api.open-meteo.com,国内实测(2026-11-18 嘉兴出口)
首包 8.38s 直接 ReadTimeout,第二次才 1.81s —— 偶发失败时桌宠只能干说
「天气服务打不开」。同一时刻中国气象局 /api/now 返回 0.18s,而且是官方数据。

三个实测结论(别再踩):
- weather.cma.cn 证书链不完整,requests 用 verify=True 必 SSLError。该站只读公开
  天气、不带任何凭据,这里固定走 http(实测 200);不向它发任何写请求。
- /api/now 的 ?name= / ?lat=&lon= 参数**不生效**(无论传什么,都按出口 IP 返回当地站点,
  实测北京/广州/伦敦坐标全都回嘉兴 58452)。要按城市取天气,必须先自己查站点表。
- 站点表 /api/station 一次给 2440 条(带经纬度/adcode,290KB/0.32s),本地按最近距离
  或同名匹配即可,不需要再维护一套城市码表。

对外只暴露四个函数:weather() / weather_cached() / cma_place() / ip_location()。
任何失败返回 None,调用方决定是回落还是报错,这里不抛异常、不弹错。
"""
import math
from datetime import datetime

import requests
from django.core.cache import cache

from .views_nav_base import _NAV_META_UA, logger

_CMA_BASE = 'http://weather.cma.cn'
_CMA_STATION_URL = _CMA_BASE + '/api/station'
_CMA_HEADERS = {'User-Agent': _NAV_META_UA, 'Referer': _CMA_BASE + '/'}
_CMA_TIMEOUT = 3                  # 实况/预报各一次,3 秒足够(实测 0.18s)
_STATION_CACHE_KEY = 'nav_pet_cma_stations_v1'
_STATION_DOWN_KEY = _STATION_CACHE_KEY + ':down'
_STATION_TTL = 7 * 24 * 3600
_WX_CACHE_TTL = 600               # 实况 10 分钟:再短就浪费站点配额,再长会显示过时温度

_OM_URL = 'https://api.open-meteo.com/v1/forecast'
_OM_TIMEOUT = 4                   # 落到境外兜底时别再各等 5 秒,两层加起来会顶穿前端预算
_OM_TRIES = 2                     # 实测第一次容易超时,第二次通常 2 秒内回来

# WMO 天气码 → 中文(仅 Open-Meteo 兜底要;CMA 直接给 dayText/nightText)
_WMO_TEXT = {
    0: '晴', 1: '基本晴', 2: '局部多云', 3: '阴', 45: '雾', 48: '雾凇',
    51: '毛毛雨', 53: '毛毛雨', 55: '浓毛毛雨', 56: '冻毛毛雨', 57: '浓冻毛毛雨',
    61: '小雨', 63: '中雨', 65: '大雨', 66: '冻雨', 67: '冻雨',
    71: '小雪', 73: '中雪', 75: '大雪', 77: '雪粒', 80: '阵雨', 81: '阵雨',
    82: '强阵雨', 85: '阵雪', 86: '阵雪', 95: '雷暴', 96: '雷暴冰雹', 99: '雷暴冰雹',
}


def _round(value):
    """四舍五入成整数。Python 的 round() 是银行家舍入(0.5→0),气温上会差一度。"""
    try:
        return int(math.floor(float(value) + 0.5))
    except (TypeError, ValueError):
        return None


def _dist_km(lat1, lon1, lat2, lon2):
    """球面距离(km)。站点选最近用,取 0.1° 精度够。"""
    dlat = math.radians(float(lat2) - float(lat1))
    dlon = math.radians(float(lon2) - float(lon1))
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(float(lat1))) * math.cos(math.radians(float(lat2))
         ) * math.sin(dlon / 2) ** 2)
    return 6371.0 * 2 * math.asin(min(1.0, math.sqrt(a)))


def _strip_suffix(name):
    """去掉行政后缀再比:朝阳/朝阳市/朝阳区 视为同一个名字。"""
    return str(name or '').strip().rstrip('市县区旗盟')


def in_china(lat, lon):
    """粗判是否在国内(含港澳)。海外城市直接走 Open-Meteo,不要拿国内站点硬套。

    南界放到 15°:三沙(16.83,112.33)原先被排除,海南用户选三沙会白等一次境外超时。
    """
    try:
        return 15.0 <= float(lat) <= 53.6 and 73.0 <= float(lon) <= 135.2
    except (TypeError, ValueError):
        return False


def _cma_data(path, params=None, timeout=_CMA_TIMEOUT):
    """取 weather.cma.cn 的 data 段。任何失败(超时/非 JSON/code!=0)一律 None。"""
    try:
        r = requests.get(_CMA_BASE + path, params=params or {}, timeout=timeout,
                         headers=_CMA_HEADERS)
        if r.status_code != 200:
            return None
        body = r.json()
        if not isinstance(body, dict) or body.get('code') != 0:
            return None
        return body.get('data')
    except Exception as exc:   # 网络/解析/证书任何毛病都当没有:天气取不到不该让请求 500
        logger.debug('中国气象局接口不可用 %s:%s', path, exc)
        return None


def station_index():
    """全国站点表(2440 条),本地缓存 7 天。失败返回 [] —— 调用方据此回落 Open-Meteo。"""
    cached = cache.get(_STATION_CACHE_KEY)
    if cached:
        return cached
    # 站点表挂了的时候别每次都再等 8 秒:10 分钟内直接认输,走境外兜底。
    # (否则一次网络抖动会让之后每个页签的首次问天气都卡满 8 秒)
    if cache.get(_STATION_DOWN_KEY):
        return []
    data = _cma_data('/api/station', timeout=8)
    rows = []
    for s in (data or []):
        if not isinstance(s, dict) or not s.get('stationid'):
            continue
        try:
            rows.append({'id': str(s['stationid']), 'name': str(s.get('name') or ''),
                         'lat': float(s['lat']), 'lon': float(s['lon']),
                         'level': s.get('level'), 'location': str(s.get('location') or '')})
        except (KeyError, TypeError, ValueError):
            continue
    if rows:
        cache.set(_STATION_CACHE_KEY, rows, _STATION_TTL)
    else:
        cache.set(_STATION_DOWN_KEY, 1, 600)
    return rows


def pick_station(lat, lon, name='', stations=None, max_km=60):
    """按坐标找最近站点;有同名站优先同名,没有就退到 60km 内的最近站。

    同名优先:避免「朝阳」被并到隔壁(北京朝阳区 54433 / 辽宁朝阳市 54324)。
    近站兜底:气象局站点表里 70 来个城市根本没有同名站 —— 上海只有「徐家汇」、
    重庆只有「沙坪坝」、佛山只有「南海」、惠州只有「惠阳」…… 城市表用的是市政府
    坐标,离这些站几公里到十几公里,拿它们代表本市是准的;超过 60km 才认输回落
    境外源(新疆兵团市最远 53km,刚好在内)。
    """
    rows = stations if stations is not None else station_index()
    if not rows:
        return None
    try:
        nearest = min(rows, key=lambda s: _dist_km(lat, lon, s['lat'], s['lon'])) \
            if lat is not None and lon is not None else None
        near_km = _dist_km(lat, lon, nearest['lat'], nearest['lon']) if nearest else None
    except (KeyError, TypeError, ValueError):
        nearest, near_km = None, None
    if name:
        key = _strip_suffix(name)
        same = [s for s in rows if _strip_suffix(s.get('name')) == key]
        if same:
            if lat is None or lon is None:
                # 没坐标时按级别挑(地级市优先于区县),不按经度乱排
                return sorted(same, key=lambda s: (s.get('level') if isinstance(s.get('level'), int) else 9))[0]
            try:
                return min(same, key=lambda s: _dist_km(lat, lon, s['lat'], s['lon']))
            except (KeyError, TypeError, ValueError):
                return None
        # 没有同名站:只有离得够近才敢用,否则返回 None 让上层回落
        return nearest if (nearest and near_km is not None and near_km <= max_km) else None
    if lat is None or lon is None:
        return None
    return nearest


def _region_of(station):
    """站点 location 形如「浙江,嘉兴」/「北京,北京」,取前一段当省/直辖市。"""
    parts = [p.strip() for p in str(station.get('location') or '').split(',') if p.strip()]
    return parts[0] if len(parts) > 1 else ''


def _now_ok(payload):
    """实况是否可信:9999=缺测(湖州 K5454 常年这么回),时间太久=停更。

    气象局把一批不再维护的自动站留在表里,不筛掉就会显示「9999°C」。
    """
    if not isinstance(payload, dict):
        return False
    now = payload.get('now')
    if not isinstance(now, dict):
        return False
    t = now.get('temperature')
    if not isinstance(t, (int, float)) or float(t) in (9999.0,) or not -60.0 <= float(t) <= 60.0:
        return False
    upd = str(payload.get('lastUpdate') or '')
    if upd:
        try:
            dt = datetime.strptime(upd, '%Y/%m/%d %H:%M')
        except ValueError:
            return True
        if (datetime.now() - dt).total_seconds() > 3 * 86400:
            return False
    return True


def station_alternatives(lat, lon, name='', stations=None, exclude=(), max_km=60, limit=4):
    """备选站:同名站之外,60km 内按距离排;只在首选站缺测/停更时才用。

    只读已经缓存过的站点表,不再触发网络 —— 首个站点都不可信时再拉 290KB
    站点表等于双重等待,不如直接认输回落。
    """
    rows = stations if stations is not None else (cache.get(_STATION_CACHE_KEY) or [])
    if not rows or lat is None or lon is None:
        return []
    skip = set(str(x) for x in exclude)
    scored = []
    for s in rows:
        if str(s.get('id')) in skip:
            continue
        try:
            d = _dist_km(lat, lon, s['lat'], s['lon'])
        except (KeyError, TypeError, ValueError):
            continue
        if d <= max_km:
            scored.append((d, s))
    out = []
    for _, s in sorted(scored, key=lambda x: x[0]):
        if str(s.get('id')) in skip or s in out:
            continue
        out.append(s)
        if len(out) >= limit:
            break
    return out


def cma_weather(lat, lon, name=''):
    """中国气象局实况 + 明日预报。取不到返回 None。"""
    if not in_china(lat, lon):
        return None
    st = pick_station(lat, lon, name)
    if not st:
        return None
    payload = _cma_data('/api/now/%s' % st['id'])
    if not _now_ok(payload):
        # 首选站是缺测/停更的死站(湖州 K5454 就是):顺延到 60km 内的有效站
        for alt in station_alternatives(lat, lon, name, exclude={st['id']}):
            payload = _cma_data('/api/now/%s' % alt['id'])
            if _now_ok(payload):
                st = alt
                break
    if not _now_ok(payload):
        return None
    now = payload.get('now')
    view = _cma_data('/api/weather/view', {'stationid': st['id']}) or {}
    daily = view.get('daily') if isinstance(view, dict) else None
    daily = daily if isinstance(daily, list) else []
    today = daily[0] if daily and isinstance(daily[0], dict) else {}
    tomorrow = daily[1] if len(daily) > 1 and isinstance(daily[1], dict) else {}
    # 天气文字:CMA 的 now 段不带天象,用当天预报补;按观测小时选白天/夜间那一段
    hour = 12
    last = str(view.get('lastUpdate') or '')
    try:
        hour = int(last.split(' ')[-1].split(':')[0])
    except (IndexError, ValueError):
        hour = 12
    text = (today.get('dayText') if 6 <= hour < 18 else (today.get('nightText') or today.get('dayText'))) or ''
    wind_speed = now.get('windSpeed')
    wind_kmh = _round(float(wind_speed) * 3.6) if isinstance(wind_speed, (int, float)) else None
    out = {
        'source': 'cma',
        'station': st['id'],
        'place': (str(name).strip() if name else '') or st.get('name') or '',
        'region': _region_of(st),
        'temp': _round(now.get('temperature')),
        'feels': _round(now.get('feelst')),
        'text': text,
        'humidity': _round(now.get('humidity')),
        'windKmh': wind_kmh,
        'windScale': str(now.get('windScale') or ''),
        'obs': last.split(' ')[-1][:5] if last else '',
        'tomorrow': None,
    }
    if tomorrow:
        out['tomorrow'] = {
            'date': str(tomorrow.get('date') or '').replace('/', '-'),
            'text': str(tomorrow.get('dayText') or ''),
            'tmax': _round(tomorrow.get('high')),
            'tmin': _round(tomorrow.get('low')),
            'rain': None,      # 官方接口这段不带降水概率,前端按缺省处理
            'uv': None,
        }
    return out


def _om_json(params, timeout=_OM_TIMEOUT):
    for i in range(_OM_TRIES):
        try:
            r = requests.get(_OM_URL, params=params, timeout=timeout,
                             headers={'User-Agent': _NAV_META_UA})
            if r.status_code == 200:
                return r.json()
        except (requests.RequestException, ValueError) as exc:
            logger.debug('Open-Meteo 第 %d 次失败:%s', i + 1, exc)
    return None


def open_meteo_weather(lat, lon):
    """Open-Meteo 兜底(海外城市 / 国内站点表取不到时)。取不到返回 None。"""
    data = _om_json({
        'latitude': lat, 'longitude': lon, 'timezone': 'auto', 'forecast_days': 2,
        'cell_selection': 'land',      # 沿海城市取陆地格点,温度更贴真实
        'current': ('temperature_2m,relative_humidity_2m,apparent_temperature,'
                    'weather_code,wind_speed_10m'),
        'daily': ('weather_code,temperature_2m_max,temperature_2m_min,'
                  'precipitation_probability_max,uv_index_max'),
    })
    if not isinstance(data, dict):
        return None
    cur = data.get('current') or {}
    if not isinstance(cur.get('temperature_2m'), (int, float)):
        return None
    code = cur.get('weather_code')
    out = {
        'source': 'open-meteo',
        'station': '',
        'place': '',
        'region': '',
        'temp': _round(cur.get('temperature_2m')),
        'feels': _round(cur.get('apparent_temperature')),
        'text': _WMO_TEXT.get(code, '未知天象'),
        'humidity': _round(cur.get('relative_humidity_2m')),
        'windKmh': _round(cur.get('wind_speed_10m')),
        'windScale': '',
        'obs': str(cur.get('time') or '')[11:16],
        'tomorrow': None,
    }
    daily = data.get('daily') or {}
    try:
        tmax, tmin = daily['temperature_2m_max'][1], daily['temperature_2m_min'][1]
        if isinstance(tmax, (int, float)) and isinstance(tmin, (int, float)):
            rain = (daily.get('precipitation_probability_max') or [None, None])[1]
            uv = (daily.get('uv_index_max') or [None, None])[1]
            out['tomorrow'] = {
                'date': str((daily.get('time') or ['', ''])[1]),
                'text': _WMO_TEXT.get((daily.get('weather_code') or [0, 0])[1], ''),
                'code': (daily.get('weather_code') or [0, 0])[1],
                'tmax': _round(tmax), 'tmin': _round(tmin),
                'rain': int(rain) if isinstance(rain, (int, float)) else None,
                'uv': round(float(uv), 1) if isinstance(uv, (int, float)) else None,
            }
    except (KeyError, IndexError, TypeError, ValueError):
        pass
    return out


def weather(lat, lon, name=''):
    """取天气:国内优先中国气象局,失败或海外走 Open-Meteo。都没有返回 None。"""
    if in_china(lat, lon):
        wx = cma_weather(lat, lon, name)
        if wx:
            return wx
    return open_meteo_weather(lat, lon)


def weather_cached(lat, lon, name='', ttl=_WX_CACHE_TTL):
    """带 10 分钟缓存的 weather()。同一对坐标的多个页签/多次点播只打一次上游。"""
    try:
        key = 'nav_pet_wx_v1:%.2f:%.2f:%s' % (float(lat), float(lon), str(name or '').strip()[:16])
    except (TypeError, ValueError):
        return None
    cached = cache.get(key)
    if cached is not None:
        return cached
    wx = weather(lat, lon, name)
    if wx:
        cache.set(key, wx, ttl)
    return wx


_IPAPI_URL = 'http://ip-api.com/json/'      # 免费档只给 http,且 45 次/分钟
_IPAPI_TIMEOUT = 3


def _ipapi_location():
    """出口 IP 定位二手兜底(ip-api 免费档,无需 key)。失败返回 None。"""
    try:
        r = requests.get(_IPAPI_URL,
                         params={'lang': 'zh-CN',
                                 'fields': 'status,country,regionName,city,lat,lon'},
                         timeout=_IPAPI_TIMEOUT, headers={'User-Agent': _NAV_META_UA})
        data = r.json()
    except Exception as exc:   # 网络/限流/非 JSON 一律当没有
        logger.debug('ip-api 定位失败:%s', exc)
        return None
    if not isinstance(data, dict) or data.get('status') != 'success':
        return None
    try:
        lat, lon = float(data.get('lat')), float(data.get('lon'))
    except (TypeError, ValueError):
        return None
    if not (-90 <= lat <= 90 and -180 <= lon <= 180) or (abs(lat) < 1e-6 and abs(lon) < 1e-6):
        return None
    name = str(data.get('city') or '').strip()
    if not name:
        return None
    return {'name': name, 'region': str(data.get('regionName') or '').strip(),
            'lat': lat, 'lon': lon, 'source': 'ip-api'}


def ip_location():
    """按本机出口 IP 定位,给「还没选过城市」的天气兜底。

    主路用中国气象局 `/api/now` 无参数形态:实测它按出口 IP 返回当地站点,
    data.location 直接带 id/name/path/latitude/longitude(嘉兴出口回「浙江,嘉兴」)。
    这条不需要任何 key,和天气主源是同一家,顺带省掉一次境外请求。
    次路 ip-api(免费档,45 次/分钟);两路都失败返回 None,由调用方让用户手动选城市。
    """
    data = _cma_data('/api/now', timeout=_CMA_TIMEOUT)
    loc = data.get('location') if isinstance(data, dict) else None
    if isinstance(loc, dict):
        try:
            lat, lon = float(loc.get('latitude')), float(loc.get('longitude'))
        except (TypeError, ValueError):
            lat = lon = None
        if lat is not None and -90 <= lat <= 90 and -180 <= lon <= 180 \
                and not (abs(lat) < 1e-6 and abs(lon) < 1e-6):
            path = [p.strip() for p in str(loc.get('path') or '').split(',') if p.strip()]
            return {'name': str(loc.get('name') or '').strip(),
                    'region': path[1] if len(path) > 1 else '',
                    'lat': lat, 'lon': lon, 'source': 'cma-ip'}
    return _ipapi_location()


def cma_place(name):
    """拿站点表当国内地名库:唯一同名 → 直接给经纬度,省掉一次外网地理编码。

    重名(朝阳)不在少数,这里只求「不更差」:多个同名时取 level 小的(地级市优先),
    真正的区县级消歧仍交给原来的 open-meteo/Nominatim 链路 —— 本函数只在它们
    都失败时被调用。
    """
    rows = station_index()
    key = _strip_suffix(name)
    if not rows or not key:
        return None
    same = [s for s in rows if _strip_suffix(s.get('name')) == key]
    if not same:
        return None
    best = sorted(same, key=lambda s: (s.get('level') if isinstance(s.get('level'), int) else 9,
                                       -float(s.get('lat') or 0)))[0]
    return {'name': best.get('name') or name, 'region': _region_of(best),
            'lat': best['lat'], 'lon': best['lon'], 'source': 'cma'}
