"""把位置换成「城市级」信息写进 partner.json。

只保存城市名和城市中心的大概坐标，不保存精确位置（仓库是公开的）。
输入（环境变量）：LAT / LON（来自 iPhone 捷径），或 CITY（手动输入城市名，「隐藏」则关闭小卡）。
输出：GITHUB_OUTPUT 里的 changed=true/false。
"""
import json, os, re, sys, urllib.parse, urllib.request
from datetime import datetime, timezone

PATH = "partner.json"
UA = "xiangban-weather-updater/1.0"


def nominatim(endpoint, params):
    params = {**params, "format": "jsonv2", "accept-language": "zh-CN", "namedetails": "1", "addressdetails": "1"}
    url = f"https://nominatim.openstreetmap.org/{endpoint}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.load(resp)


MUNICIPALITIES = {"CN-BJ": "北京", "CN-SH": "上海", "CN-TJ": "天津", "CN-CQ": "重庆", "CN-HK": "香港", "CN-MO": "澳门"}
TRAD = str.maketrans({"臺": "台", "灣": "湾", "國": "国", "紐": "纽", "約": "约", "門": "门", "東": "东", "華": "华", "蘭": "兰", "爾": "尔", "鎮": "镇", "縣": "县", "鄉": "乡", "區": "区", "東": "东"})


def city_name(result):
    address = result.get("address") or {}
    # 直辖市里返回的是「区」，换成城市名
    municipality = MUNICIPALITIES.get(address.get("ISO3166-2-lvl4", ""))
    if municipality:
        return municipality
    for key in ("city", "town", "county", "municipality", "state_district", "state"):
        if address.get(key):
            name = address[key]
            break
    else:
        name = (result.get("namedetails") or {}).get("name:zh") or result.get("name") or "我这边"
    name = name.split(";")[0].strip()
    return re.sub(r"(市|特别行政区)$", "", name.translate(TRAD)) or name


def reverse_city(lat, lon):
    params = urllib.parse.urlencode({"latitude": lat, "longitude": lon, "localityLanguage": "zh"})
    req = urllib.request.Request(f"https://api.bigdatacloud.net/data/reverse-geocode-client?{params}", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as resp:
        data = json.load(resp)
    city, locality = data.get("city") or "", data.get("locality") or ""
    # 自治州之类的名字太长，用下面的县级市（如 恩施土家族苗族自治州 → 恩施）
    if (not city or city.endswith(("自治州", "地区", "盟"))) and locality:
        city = locality
    # 台湾的乡镇（如 竹東鎮）她不一定认得，改用县市（新竹）
    if city.endswith(("鎮", "镇", "鄉", "乡")) and data.get("principalSubdivision"):
        city = data["principalSubdivision"]
    name = (city or data.get("principalSubdivision") or "我这边").translate(TRAD).strip()
    return re.sub(r"(市|都|縣|县|特别行政区)$", "", name) or name


def to_float(value):
    try:
        number = float(str(value).strip().replace(",", "."))
    except ValueError:
        return None
    return number if number == number else None


def main():
    lat, lon, city = to_float(os.environ.get("LAT", "")), to_float(os.environ.get("LON", "")), os.environ.get("CITY", "").strip()

    if city in ("隐藏", "hide", "关闭"):
        data = {"hidden": True}
    elif lat is not None and lon is not None and -90 <= lat <= 90 and -180 <= lon <= 180:
        # 只保留到小数点后 1 位（约 10 公里），够查城市天气，又不会暴露精确位置
        data = {"name": reverse_city(lat, lon), "latitude": round(lat, 1), "longitude": round(lon, 1)}
    elif city:
        results = nominatim("search", {"q": city, "limit": 1})
        if not results:
            sys.exit(f"找不到这个城市：{city}")
        data = {"name": city_name(results[0]) if len(city) > 6 else re.sub(r"市$", "", city),
                "latitude": round(float(results[0]["lat"]), 2), "longitude": round(float(results[0]["lon"]), 2)}
    else:
        sys.exit("没有收到位置或城市名")

    try:
        with open(PATH, encoding="utf-8") as f:
            old = json.load(f)
    except (OSError, ValueError):
        old = {}

    same = (old.get("hidden") and data.get("hidden")) or (
        old.get("name") == data.get("name") and not old.get("hidden") and not data.get("hidden"))
    print(f"新的：{data}；原来：{old}；{'没有变化' if same else '需要更新'}")
    if not same:
        data["updated"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
        with open(PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")
    with open(os.environ.get("GITHUB_OUTPUT", os.devnull), "a") as out:
        out.write(f"changed={'false' if same else 'true'}\n")


if __name__ == "__main__":
    main()
