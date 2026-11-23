"""中文名称拼音首字母辅助(2026-11-19)。

服务端在渲染卡片时直接算出首字母并写入 ``data-initial``,不再要求用户手动跑脚本刷新静态映射表。
``pypinyin`` 缺失时降级为空串:原文搜索仍可用,只是不提供首字母检索。
"""

from functools import lru_cache


def _lazy_pinyin():
    try:
        from pypinyin import lazy_pinyin
        return lazy_pinyin
    except Exception:
        return None


@lru_cache(maxsize=4096)
def _initial_for_char(ch: str) -> str:
    """返回单个汉字的小写首字母;无法解析时返回空串。"""
    lazy = _lazy_pinyin()
    if lazy is None:
        return ''
    try:
        pinyin = lazy(ch, errors='ignore')
    except Exception:
        return ''
    if not pinyin or not pinyin[0]:
        return ''
    letter = str(pinyin[0])[:1].lower()
    return letter if letter.isascii() and letter.isalpha() else ''


@lru_cache(maxsize=10000)
def name_initial(name: str) -> str:
    """把站点名称转成可检索的首字母串:拉丁/数字保留,汉字取首字母。"""
    out = []
    for ch in str(name or '').lower():
        if ch.isascii() and ch.isalnum():
            out.append(ch)
        elif '一' <= ch <= '鿿':
            out.append(_initial_for_char(ch))
    return ''.join(out)
