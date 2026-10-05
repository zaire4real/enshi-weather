#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
每天由 GitHub Actions 觸發：抓中國天氣網恩施今日資料，更新 index.html 快照區。
只動靜態快照區，不動任何 id=live* 的即時元素與動態渲染 JS。
"""
import re, sys, subprocess, os, tempfile, datetime

URL = "https://www.weather.com.cn/weather/101201001.shtml"
HTML = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "index.html")

# 簡→繁天氣字串 mapping（只覆蓋會出現在快照描述裡的詞）
S2T = [
    ("雷阵雨", "雷陣雨"), ("阵雨", "陣雨"), ("毛毛雨", "毛毛雨"),
    ("小雨转", "小雨轉"), ("中雨转", "中雨轉"), ("大雨转", "大雨轉"),
    ("转多云", "轉多雲"), ("转阴", "轉陰"), ("转晴", "轉晴"),
    ("多云", "多雲"), ("阴天", "陰天"), ("晴", "晴"),
    ("雾", "霧"), ("霾", "霾"),
]
def to_tw(s):
    for a, b in S2T:
        s = s.replace(a, b)
    return s

def fetch():
    with tempfile.NamedTemporaryFile(suffix=".html", delete=False) as tf:
        tmp = tf.name
    subprocess.run([
        "curl", "-sL", "--max-time", "25",
        "-A", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "-o", tmp, URL
    ], check=True)
    with open(tmp, encoding="utf-8", errors="ignore") as f:
        return f.read()

def main():
    raw = fetch()
    # 1) 今日天氣+溫度：hidden_title "10月05日20时 周一  多云  15/28°C"
    m = re.search(r'hidden_title"\s+value="([^"]+)"', raw)
    if not m:
        print("ERROR: hidden_title not found", file=sys.stderr); sys.exit(1)
    title = m.group(1).strip()
    # 解析："10月05日20时 周一  多云  15/28°C"
    mt = re.match(r'(\d{1,2})月(\d{1,2})日(\d{1,2})时\s*周.+\s+([\u4e00-\u9fff·]+?)\s+(\d+)\s*/\s*(\d+)\s*°C', title)
    if not mt:
        print(f"ERROR: title parse failed: {title}", file=sys.stderr); sys.exit(1)
    mon, day, _, wx_cn, hi, lo = mt.groups()
    hi, lo = int(hi), int(lo)
    if lo > hi: lo, hi = hi, lo  # 保險
    wx_tw = to_tw(wx_cn)
    # 2) 更新時間：頁面第一個 YYYY-MM-DD HH:MM
    mu = re.search(r'(20\d{2})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})', raw)
    upd = mu.group(0) if mu else datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    yy, MM, DD, HH, MMi = mu.groups()
    short = f"{MM}-{DD}"
    print(f"parsed: {upd} | {wx_cn}/{wx_tw} | {lo}~{hi}")

    p = os.path.abspath(HTML)
    s = open(p, encoding="utf-8").read()
    orig = s

    # --- 替換 1: hero 快照時間戳 <b>2026-.. ..:..</b> ---
    s = re.sub(r'(<span data-i18n="meta\.snap">官方快照：</span><b>)[^<]+(</b>)',
               rf'\g<1>{upd}\g<2>', s, count=1)

    # --- 替換 2: hero 官方今日 HTML ---
    new_hero_tw = f"官方今日 {lo}°C ~ {hi}°C · {wx_tw}"
    new_hero_cn = f"官方今日 {lo}°C ~ {hi}°C · {wx_cn}"
    s = re.sub(r'(<div class="now-range" data-i18n="hero\.range">)[^<]*(</div>)',
               rf'\g<1>{new_hero_tw}\g<2>', s, count=1)
    # 字典行（繁：'w.shower':'陣雨'...；簡：'w.shower':'阵雨'...）
    s = re.sub(r"('w\.shower':'陣雨','hero\.today':'今天','hero\.range':')[^']*(')",
               rf"\g<1>{new_hero_tw}\g<2>", s, count=1)
    s = re.sub(r"('w\.shower':'阵雨','hero\.today':'今天','hero\.range':')[^']*(')",
               rf"\g<1>{new_hero_cn}\g<2>", s, count=1)

    # --- 替換 3: 六格氣溫 ---
    s = re.sub(r'(<div class="v">)\d+\s*~\s*\d+(<small>°C</small></div>)',
               rf'\g<1>{lo} ~ {hi}\g<2>', s, count=1)

    # --- 替換 4: 天氣/降水格 ---
    # HTML 靜態（預設繁體）
    s = re.sub(r'(<div class="v" data-i18n="g\.weather\.v">)[^<]*(</div>)',
               rf'\g<1>{wx_tw}\g<2>', s, count=1)
    rain_tw = f"{wx_tw} · 無降水" if "雨" not in wx_tw and "陣" not in wx_tw and "雷" not in wx_tw else wx_tw
    rain_cn = f"{wx_cn} · 无降水" if "雨" not in wx_cn and "阵" not in wx_cn and "雷" not in wx_cn else wx_cn
    s = re.sub(r'(<div class="v" data-i18n="g\.rain\.v">)[^<]*(</div>)',
               rf'\g<1>{rain_tw}\g<2>', s, count=1)
    # 字典行（繁/簡）
    s = re.sub(r"('g\.weather\.v':')[^']*(')", rf"\g<1>{wx_tw}\g<2>", s, count=1)
    s = re.sub(r"('g\.rain\.v':')[^']*(')", rf"\g<1>{rain_tw}\g<2>", s, count=1)
    # 第二輪字典行是簡體
    s = re.sub(r"('g\.weather\.v':')[^']*(')", rf"\g<1>{wx_cn}\g<2>", s, count=1)
    s = re.sub(r"('g\.rain\.v':')[^']*(')", rf"\g<1>{rain_cn}\g<2>", s, count=1)

    # --- 替換 5: note 快照日期 ---
    s = re.sub(r'官方快照 \d{2}-\d{2}', f'官方快照 {short}', s)
    s = re.sub(r'上方四卡為 \d{2}-\d{2} 參考', f'上方四卡為 {short} 參考', s)
    s = re.sub(r'上方四卡为 \d{2}-\d{2} 参考', f'上方四卡为 {short} 参考', s)

    # --- 替換 6: 來源更新時間 ---
    s = re.sub(r'\d{2}-\d{2} \d{2}:\d{2} 更新', f'{short} {HH}:{MMi} 更新', s)

    if s == orig:
        print("WARNING: no replacement made", file=sys.stderr); sys.exit(2)
    open(p, "w", encoding="utf-8").write(s)
    print("OK: index.html updated")

if __name__ == "__main__":
    main()
