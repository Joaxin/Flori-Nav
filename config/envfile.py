# -*- coding: utf-8 -*-
"""极简 .env 读取(不引入 python-dotenv 依赖)。

规则刻意少而稳:
- 空行、# 开头的整行注释跳过;
- 拆 KEY=VALUE(只在第一个 = 处拆,值里可以再有 =);
- 值两侧成对引号剥掉;
- 已存在的真实环境变量优先(setdefault 语义),部署平台注入的变量不会被 .env 覆盖;
- 编码容错:Windows 记事本常把 .env 存成 GBK,直接按 utf-8 读会在 import settings
  阶段抛 UnicodeDecodeError——整个项目起不来,比读不到还糟,所以 utf-8-sig → GBK 依次尝试。

不支持行尾注释:密钥里出现 " #" 并不罕见,宁可不支持也不能截断密码。
"""


def parse_env(text):
    """把 .env 文本解析成 dict。"""
    out = {}
    for raw in (text or '').splitlines():
        line = raw.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        key = key.strip()
        if not key:
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
            value = value[1:-1]
        out[key] = value
    return out


def decode_env_bytes(raw):
    """字节 → 文本。UTF-8(含 BOM)优先,回落 GBK;都不行返回空串。"""
    for encoding in ('utf-8-sig', 'gbk'):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return ''


def load_env_file(path, environ):
    """读取 .env 并写入 environ(已存在的键不覆盖)。返回实际写入的键数。

    文件不存在时返回 0(静默)——没有 .env 是正常状态,不是错误。
    """
    try:
        with open(path, 'rb') as fh:
            raw = fh.read()
    except OSError:
        return 0
    loaded = 0
    for key, value in parse_env(decode_env_bytes(raw)).items():
        if key not in environ:
            environ[key] = value
            loaded += 1
    return loaded
