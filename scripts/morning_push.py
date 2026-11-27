"""每天早上看一眼她那边的天气，需要时推送提醒。

Secrets：
  PUSH_SUBSCRIPTION          她在网页上「开启提醒」后复制给你的代码（收给她的提醒）
  PUSH_SUBSCRIPTION_PARTNER  你自己手机上的代码（收「小湘那边」的天气）
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


def weather_facts(data):
    daily, hourly = data["daily"], data["hourly"]
    today = daily["time"][-1]
    hi, lo = daily["temperature_2m_max"][-1], daily["temperature_2m_min"][-1]
    hi_yesterday = daily["temperature_2m_max"][0] if len(daily["time"]) > 1 else hi

    # 只看今天白天 7–21 点
    idx = [i for i, t in enumerate(hourly["time"]) if t.startswith(today) and 7 <= int(t[11:13]) <= 21]
    probs = [hourly["precipitation_probability"][i] or 0 for i in idx]
    rain = sum(hourly["precipitation"][i] or 0 for i in idx)
    first = next((hourly["time"][i][11:13] for i in idx if (hourly["precipitation_probability"][i] or 0) >= 50 or (hourly["precipitation"][i] or 0) >= .2), None)

    facts = {"today": today, "range": round(hi - lo)}
    if max(probs, default=0) >= 50 or rain >= 1:
        facts["rain"] = int(first) if first else None
    if hi_yesterday - hi >= 6:
        facts["colder"] = round(hi_yesterday - hi)
    elif daily["apparent_temperature_min"][-1] <= 3:
        facts["cold"] = round(daily["apparent_temperature_min"][-1])
    return facts


def her_message(facts, special):
    tips = []
    if "rain" in facts:
        tips.append(f"今天{facts['rain']}点前后可能下雨，记得带伞" if facts["rain"] else "今天可能下雨，记得带伞")
    if "colder" in facts:
        tips.append(f"今天比昨天冷了{facts['colder']}°，多穿一件")
    elif "cold" in facts:
        tips.append(f"今天挺冷，体感最低{facts['cold']}°，穿暖一点")
    # 温差只做补充：恩施冬天几乎天天温差大，单独提醒会变成每天打扰
    if tips and facts["range"] >= 10 and len(tips) < 2:
        tips.append(f"早晚温差{facts['range']}°，外套带着")
    if special:
        return special + ("\n" + "；".join(tips) + "。" if tips else "")
    return f"{PERSON}，" + "；".join(tips[:2]) + "。" if tips else None


def partner_message(facts):
    tips = []
    if "rain" in facts:
        tips.append(f"{PERSON}那边{facts['rain']}点前后可能下雨，提醒她带伞 ☂️" if facts["rain"] else f"{PERSON}那边今天可能下雨，提醒她带伞 ☂️")
    if "colder" in facts:
        tips.append(f"{PERSON}那边比昨天冷了{facts['colder']}°，提醒她多穿点")
    elif "cold" in facts:
        tips.append(f"{PERSON}那边体感最低{facts['cold']}°，挺冷的，关心她一下")
    return "；".join(tips) if tips else None


def send(info, body, title):
    import tempfile
    from pywebpush import webpush, WebPushException
    # pywebpush 读 PEM 需要文件路径
    with tempfile.NamedTemporaryFile("w", suffix=".pem", delete=False) as key_file:
        key_file.write(os.environ["VAPID_PRIVATE_KEY"].strip() + "\n")
    try:
        webpush(subscription_info=info["s"], data=json.dumps({"title": title, "body": body}, ensure_ascii=False),
                ttl=6 * 3600, vapid_private_key=key_file.name, vapid_claims={"sub": SITE})
        return None
    except WebPushException as error:
        if getattr(error.response, "status_code", None) in (404, 410):
            return "提醒已失效（可能删过桌面图标或关了通知），请在网页上重新开启提醒，再把新代码设定一次。"
        return str(error)
    finally:
        os.remove(key_file.name)


def main():
    her_code, partner_code = os.environ.get("PUSH_SUBSCRIPTION", ""), os.environ.get("PUSH_SUBSCRIPTION_PARTNER", "")
    if not her_code and not partner_code:
        print("还没有设定 PUSH_SUBSCRIPTION（她开启提醒后会得到一段代码），先跳过。")
        return
    her = decode_code(her_code) if her_code else None
    partner = decode_code(partner_code) if partner_code else None
    # 天气一律看她那边
    lat, lon = (her or {}).get("lat", 30.3), (her or {}).get("lon", 109.48)
    facts = weather_facts(forecast(lat, lon))
    force, dry = os.environ.get("FORCE") == "true", os.environ.get("DRY_RUN") == "true"

    jobs = []
    if her:
        body = her_message(facts, special_message(facts["today"]))
        if body or force:
            jobs.append(("她", her, body or f"{PERSON}，提醒已经设好啦，以后下雨、降温的早上会提醒你。", "湘伴日常"))
    if partner:
        body = partner_message(facts)
        if body or force:
            jobs.append(("你", partner, body or f"提醒设好了，{PERSON}那边下雨、降温的早上会通知你。", f"{PERSON}那边的天气"))
    if not jobs:
        print(f"{facts['today']} 天气平稳，不打扰。")
        return

    errors = []
    for who, info, body, title in jobs:
        print(f"{facts['today']} 推送给{who}：{body}")
        if dry:
            continue
        error = send(info, body, title)
        print(f"  → {'已送出' if not error else error}")
        if error:
            errors.append(f"{who}：{error}")
    if errors:
        sys.exit("\n".join(errors))


if __name__ == "__main__":
    main()
