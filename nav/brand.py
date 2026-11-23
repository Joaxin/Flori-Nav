# -*- coding: utf-8 -*-
"""品牌标识(2026-11-14)：寻花集 —— 一枚朱印，印面镂空出折枝多花。

同一个图形要出现在三处(顶栏 mark、favicon / PWA 图标、manifest 名称)，
放在一个常量里才不会只改一半。图形由 tools/brand_gen.py 生成，别手改坐标。
"""

from django.utils.safestring import mark_safe

BRAND_NAME = '寻花集'
BRAND_TAGLINE = '网址导航'
BRAND_ZHU = '#b23b2e'

# 朱印镂空：印面是实心朱红，折枝与四朵花是真透明的(mask)，
# 所以换深色主题、换任何底色都不会冒出白块。
BRAND_MARK_SVG = mark_safe(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="寻花集"><defs><mask id="xhjSeal"><rect width="64" height="64" fill="#fff"/><g fill="#000"><g transform="translate(32.0 32.0) rotate(-24.0) scale(0.880) translate(-32.0 -32.0)"><g fill="none" stroke="#000" stroke-linecap="round"><path d="M12 57C19 50 26 43 33.5 35.5" stroke-width="5.2"/><path d="M33.5 35.5C39 29.5 43.6 25 46 20.6" stroke-width="3.4"/></g><g fill="none" stroke="#000" stroke-linecap="round"><path d="M26 44C22 41 19 37.5 17.4 34.6" stroke-width="2.8"/><path d="M36 32C39.5 34.5 42.5 37 44.2 38.8" stroke-width="2.8"/></g><ellipse cx="46.80" cy="14.34" rx="2.36" ry="3.89" fill="#000" transform="rotate(24.0 46.80 18.00)"/><ellipse cx="46.80" cy="14.34" rx="2.36" ry="3.89" fill="#000" transform="rotate(96.0 46.80 18.00)"/><ellipse cx="46.80" cy="14.34" rx="2.36" ry="3.89" fill="#000" transform="rotate(168.0 46.80 18.00)"/><ellipse cx="46.80" cy="14.34" rx="2.36" ry="3.89" fill="#000" transform="rotate(240.0 46.80 18.00)"/><ellipse cx="46.80" cy="14.34" rx="2.36" ry="3.89" fill="#000" transform="rotate(312.0 46.80 18.00)"/><circle cx="46.80" cy="18.00" r="1.30" fill="#fff"/><ellipse cx="16.60" cy="28.91" rx="2.12" ry="3.50" fill="#000" transform="rotate(6.0 16.60 32.20)"/><ellipse cx="16.60" cy="28.91" rx="2.12" ry="3.50" fill="#000" transform="rotate(78.0 16.60 32.20)"/><ellipse cx="16.60" cy="28.91" rx="2.12" ry="3.50" fill="#000" transform="rotate(150.0 16.60 32.20)"/><ellipse cx="16.60" cy="28.91" rx="2.12" ry="3.50" fill="#000" transform="rotate(222.0 16.60 32.20)"/><ellipse cx="16.60" cy="28.91" rx="2.12" ry="3.50" fill="#000" transform="rotate(294.0 16.60 32.20)"/><circle cx="16.60" cy="32.20" r="1.17" fill="#fff"/><ellipse cx="45.40" cy="37.69" rx="1.88" ry="3.10" fill="#000" transform="rotate(40.0 45.40 40.60)"/><ellipse cx="45.40" cy="37.69" rx="1.88" ry="3.10" fill="#000" transform="rotate(112.0 45.40 40.60)"/><ellipse cx="45.40" cy="37.69" rx="1.88" ry="3.10" fill="#000" transform="rotate(184.0 45.40 40.60)"/><ellipse cx="45.40" cy="37.69" rx="1.88" ry="3.10" fill="#000" transform="rotate(256.0 45.40 40.60)"/><ellipse cx="45.40" cy="37.69" rx="1.88" ry="3.10" fill="#000" transform="rotate(328.0 45.40 40.60)"/><circle cx="45.40" cy="40.60" r="1.03" fill="#fff"/><ellipse cx="32.40" cy="31.38" rx="1.56" ry="2.57" fill="#000" transform="rotate(62.0 32.40 33.80)"/><ellipse cx="32.40" cy="31.38" rx="1.56" ry="2.57" fill="#000" transform="rotate(134.0 32.40 33.80)"/><ellipse cx="32.40" cy="31.38" rx="1.56" ry="2.57" fill="#000" transform="rotate(206.0 32.40 33.80)"/><ellipse cx="32.40" cy="31.38" rx="1.56" ry="2.57" fill="#000" transform="rotate(278.0 32.40 33.80)"/><ellipse cx="32.40" cy="31.38" rx="1.56" ry="2.57" fill="#000" transform="rotate(350.0 32.40 33.80)"/><circle cx="32.40" cy="33.80" r="0.86" fill="#fff"/><ellipse cx="28.2" cy="42.4" rx="2.1" ry="3.1" fill="#000" transform="rotate(42 28.2 42.4)"/></g></g></mask></defs><rect x="4" y="4" width="56" height="56" rx="8" fill="#b23b2e" mask="url(#xhjSeal)"/></svg>'
)
