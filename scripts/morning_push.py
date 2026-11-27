"""每天早上看一眼她那边的天气，需要时推送提醒。

Secrets：
  PUSH_SUBSCRIPTION  她在网页上「开启提醒」后复制给你的代码
  VAPID_PRIVATE_KEY  推送签名用的私钥（PEM）
环境变量 FORCE=true 时不管天气都发一条（用来测试）；DRY_RUN=true 只打印不发送。
"""
import base64, json, os, sys, urllib.parse, urllib.request
from datetime import datetime

PERSON = "小湘"
SITE = "https://zaire4real.github.io"  # VAPID 的 sub 只能是网址的根


def decode_code(code):
    code = code.strip()
    padded = code + "=" * (-len(code) % 4)
    return json.loads(base64.urlsafe_b64decode(padded).decode("utf-8"))


def forecast(lat, lon):
    params = urllib.parse.urlencode({
        "latitude": lat, "longitude": lon, "timezone": "auto", "past_days": 1, "forecast_days": 1,
        "hourly": "precipitation_probability,precipitation,apparent_temperature",
        "daily": "temperature_2m_max,temperature_2m_min,apparent_temperature_min",
    })
    with urllib.request.urlopen(f"https://api.open-meteo.com/v1/forecast?{params}", timeout=30) as resp:
        return json.load(resp)


def special_message(today):
    try:
        with open("messages.json", encoding="utf-8") as f:
            messages = json.load(f)
    except (OSError, ValueError):
        return None
    text = (messages.get("dates") or {}).get(today) or (messages.get("yearly") or {}).get(today[5:])
    return text.strip() if isinstance(text, str) and text.strip() else None


def build_message(data):
    daily, hourly = data["daily"], data["hourly"]
    today = daily["time"][-1]
    hi, lo = daily["temperature_2m_max"][-1], daily["temperature_2m_min"][-1]
    hi_yesterday = daily["temperature_2m_max"][0] if len(daily["time"]) > 1 else hi
    feels_min = daily["apparent_temperature_min"][-1]

    # 只看今天白天 7–21 点
    idx = [i for i, t in enumerate(hourly["time"]) if t.startswith(today) and 7 <= int(t[11:13]) <= 21]
    probs = [hourly["precipitation_probability"][i] or 0 for i in idx]
    rain = sum(hourly["precipitation"][i] or 0 for i in idx)
    first_rain = next((hourly["time"][i][11:13] for i in idx if (hourly["precipitation_probability"][i] or 0) >= 50 or (hourly["precipitation"][i] or 0) >= .2), None)

    tips = []
    if max(probs, default=0) >= 50 or rain >= 1:
        tips.append(f"今天{int(first_rain)}点前后可能下雨，记得带伞" if first_rain else "今天可能下雨，记得带伞")
    if hi_yesterday - hi >= 6:
        tips.append(f"今天比昨天冷了{round(hi_yesterday - hi)}°，多穿一件")
    elif feels_min <= 3:
        tips.append(f"今天挺冷，体感最低{round(feels_min)}°，穿暖一点")
    # 温差只做补充：恩施冬天几乎天天温差大，单独提醒会变成每天打扰
    if tips and hi - lo >= 10 and len(tips) < 2:
        tips.append(f"早晚温差{round(hi - lo)}°，外套带着")

    special = special_message(today)
    if special:
        body = special + ("\n" + "；".join(tips) + "。" if tips else "")
    elif tips:
        body = f"{PERSON}，" + "；".join(tips[:2]) + "。"
    else:
        body = None
    return today, body


def main():
    code = os.environ.get("PUSH_SUBSCRIPTION", "")
    if not code:
        print("还没有设定 PUSH_SUBSCRIPTION（她开启提醒后会得到一段代码），先跳过。")
        return
    info = decode_code(code)
    today, body = build_message(forecast(info.get("lat", 30.3), info.get("lon", 109.48)))
    force = os.environ.get("FORCE") == "true"
    if not body and not force:
        print(f"{today} 天气平稳，不打扰她。")
        return
    body = body or f"{PERSON}，提醒已经设好啦，以后下雨、降温的早上会提醒你。"
    payload = json.dumps({"title": "湘伴日常", "body": body}, ensure_ascii=False)
    print(f"{today} 推送：{body}")
    if os.environ.get("DRY_RUN") == "true":
        return

    import tempfile
    from pywebpush import webpush, WebPushException
    # pywebpush 读 PEM 需要文件路径
    with tempfile.NamedTemporaryFile("w", suffix=".pem", delete=False) as key_file:
        key_file.write(os.environ["VAPID_PRIVATE_KEY"].strip() + "\n")
    try:
        webpush(subscription_info=info["s"], data=payload, ttl=6 * 3600,
                vapid_private_key=key_file.name, vapid_claims={"sub": SITE})
        print("已送出")
    except WebPushException as error:
        status = getattr(error.response, "status_code", None)
        if status in (404, 410):
            sys.exit("她的提醒已失效（可能删除过 App 或关了通知），请她在网页上重新开启提醒，再把新代码设定一次。")
        raise
    finally:
        os.remove(key_file.name)


if __name__ == "__main__":
    main()
