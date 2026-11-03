"use strict";

const PERSON_NAME = "小湘";

const DEFAULT_LOCATION = {
  latitude: 30.3,
  longitude: 109.48333,
  name: "恩施",
  admin1: "湖北",
  country: "中国",
  detail: "定位失败时的默认位置",
  source: "default"
};

const WEATHER_CODES = {
  0: ["晴", "☀️", "sunny"], 1: ["大致晴朗", "🌤️", "sunny"], 2: ["多云", "⛅", "cloudy"], 3: ["阴天", "☁️", "cloudy"],
  45: ["有雾", "🌫️", "cloudy"], 48: ["雾凇", "🌫️", "cloudy"], 51: ["毛毛雨", "🌦️", "rainy"], 53: ["毛毛雨", "🌦️", "rainy"],
  55: ["较强毛毛雨", "🌧️", "rainy"], 56: ["冻雨", "🌧️", "rainy"], 57: ["较强冻雨", "🌧️", "rainy"], 61: ["小雨", "🌧️", "rainy"],
  63: ["中雨", "🌧️", "rainy"], 65: ["大雨", "🌧️", "rainy"], 66: ["冻雨", "🌧️", "rainy"], 67: ["较强冻雨", "🌧️", "rainy"],
  71: ["小雪", "🌨️", "snowy"], 73: ["中雪", "🌨️", "snowy"], 75: ["大雪", "❄️", "snowy"], 77: ["雪粒", "🌨️", "snowy"],
  80: ["阵雨", "🌦️", "rainy"], 81: ["较强阵雨", "🌧️", "rainy"], 82: ["强阵雨", "⛈️", "rainy"], 85: ["阵雪", "🌨️", "snowy"],
  86: ["强阵雪", "❄️", "snowy"], 95: ["雷雨", "⛈️", "rainy"], 96: ["雷雨伴冰雹", "⛈️", "rainy"], 99: ["强雷雨伴冰雹", "⛈️", "rainy"]
};

const $ = (selector) => document.querySelector(selector);
const state = { location: DEFAULT_LOCATION, weather: null, air: null, deferredInstall: null, searchTimer: null, requestId: 0 };
const clampRound = (value) => Number.isFinite(Number(value)) ? Math.round(Number(value)) : "--";
const safeNumber = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const weatherMeta = (code) => WEATHER_CODES[code] || ["天气变化中", "☁️", "cloudy"];

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2800);
}

async function fetchJson(url, timeout = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`请求失败（${response.status}）`);
    const data = await response.json();
    if (data.error) throw new Error(data.reason || "数据源返回错误");
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function weatherUrl(location) {
  const params = new URLSearchParams({
    latitude: location.latitude,
    longitude: location.longitude,
    current: "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m,wind_direction_10m",
    hourly: "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,uv_index",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_sum,precipitation_probability_max,uv_index_max,sunrise,sunset",
    minutely_15: "precipitation",
    forecast_days: "8",
    forecast_minutely_15: "8",
    timezone: "auto"
  });
  return `https://api.open-meteo.com/v1/forecast?${params}`;
}

function airUrl(location) {
  const params = new URLSearchParams({
    latitude: location.latitude,
    longitude: location.longitude,
    current: "us_aqi,pm2_5,pm10,ozone",
    timezone: "auto"
  });
  return `https://air-quality-api.open-meteo.com/v1/air-quality?${params}`;
}

async function loadWeather(location, { silent = false } = {}) {
  const requestId = ++state.requestId;
  const refreshButton = $("#refreshButton");
  refreshButton.classList.add("is-loading");
  refreshButton.disabled = true;
  if (!silent) setText("updatedTime", "正在更新…");

  const [weatherResult, airResult] = await Promise.allSettled([
    fetchJson(weatherUrl(location)),
    fetchJson(airUrl(location))
  ]);

  if (requestId !== state.requestId) return;
  refreshButton.classList.remove("is-loading");
  refreshButton.disabled = false;

  if (weatherResult.status === "rejected") {
    setText("updatedTime", "更新失败");
    showToast(navigator.onLine ? "天气暂时没有更新成功，请稍后再试" : "当前离线，已保留上次看到的页面");
    if (!state.weather) renderUnavailable();
    return;
  }

  state.location = location;
  state.weather = weatherResult.value;
  state.air = airResult.status === "fulfilled" ? airResult.value : null;
  renderLocation(location);
  renderWeather(state.weather);
  renderAir(state.air);
  persistState();
  setText("updatedTime", `更新于 ${timePart(state.weather.current.time)}`);
  if (airResult.status === "rejected") showToast("天气已更新，空气质量暂时不可用");
}

function renderLocation(location) {
  const name = stripSuffix(cleanPlaceName(location.name || "当前位置"));
  const admin = stripSuffix(cleanPlaceName(location.admin1 || ""));
  const country = stripSuffix(cleanPlaceName(location.country || ""));
  const region = admin && admin !== name ? admin : country && country !== name ? country : "";
  setText("placeName", region ? `${region} · ${name}` : name);
  setText("placeDetail", location.detail || (location.source === "gps" ? "已使用精确定位" : "天气与空气质量使用同一位置"));
}

function renderWeather(data) {
  const current = data.current;
  const daily = data.daily;
  const meta = weatherMeta(current.weather_code);
  const hourIndex = findCurrentHourIndex(data);
  const nextHours = sliceHourly(data.hourly, hourIndex, 12);

  setText("greeting", greetingText(current.time));
  setText("currentTemp", clampRound(current.temperature_2m));
  setText("conditionText", meta[0]);
  setText("feelsLike", `${clampRound(current.apparent_temperature)}°`);
  setText("todayHigh", `${clampRound(daily.temperature_2m_max[0])}°`);
  setText("todayLow", `${clampRound(daily.temperature_2m_min[0])}°`);
  setText("humidity", `${clampRound(current.relative_humidity_2m)}%`);
  setText("humidityHint", humidityHint(current.relative_humidity_2m));
  setText("windSpeed", clampRound(current.wind_speed_10m));
  setText("windDirection", `km/h · ${windDirection(current.wind_direction_10m)}`);
  setText("uvIndex", formatOne(daily.uv_index_max[0]));
  setText("uvHint", uvHint(daily.uv_index_max[0]));

  const currentRainChance = nextHours.precipitation_probability[0] ?? 0;
  setText("rainChance", `${clampRound(currentRainChance)}%`);
  setText("rainChanceHint", current.precipitation > 0 ? `当前降水 ${formatOne(current.precipitation)} mm` : "未来一小时");

  const artState = current.is_day === 0 && ![51,53,55,56,57,61,63,65,66,67,71,73,75,77,80,81,82,85,86,95,96,99].includes(current.weather_code)
    ? "night" : meta[2];
  $("#weatherArt").dataset.weather = artState;

  renderHourly(nextHours);
  renderWeek(daily);
  renderAdvice(data, nextHours);
}

function findCurrentHourIndex(data) {
  const hour = `${data.current.time.slice(0, 13)}:00`;
  const exact = data.hourly.time.indexOf(hour);
  if (exact >= 0) return exact;
  const next = data.hourly.time.findIndex((time) => time >= data.current.time);
  return next >= 0 ? next : 0;
}

function sliceHourly(hourly, start, count) {
  return Object.fromEntries(Object.entries(hourly).map(([key, values]) => [key, Array.isArray(values) ? values.slice(start, start + count) : values]));
}

function renderHourly(hourly) {
  const list = $("#hourlyList");
  list.replaceChildren();
  hourly.time.forEach((time, index) => {
    const item = document.createElement("div");
    item.className = `hour${index === 0 ? " is-now" : ""}`;
    const rain = safeNumber(hourly.precipitation_probability[index]);
    item.innerHTML = `<span class="hour-time">${index === 0 ? "现在" : timePart(time)}</span><span class="weather-symbol" aria-label="${weatherMeta(hourly.weather_code[index])[0]}">${weatherMeta(hourly.weather_code[index])[1]}</span><strong>${clampRound(hourly.temperature_2m[index])}°</strong><span class="hour-rain">${rain ? `${Math.round(rain)}%` : "—"}</span>`;
    list.append(item);
  });
}

function renderWeek(daily) {
  const list = $("#weekList");
  list.replaceChildren();
  daily.time.slice(0, 7).forEach((date, index) => {
    const row = document.createElement("div");
    row.className = "day-row";
    const chance = safeNumber(daily.precipitation_probability_max[index]);
    row.innerHTML = `<span class="day-name">${index === 0 ? "今天" : weekDay(date)}</span><span class="day-icon" aria-label="${weatherMeta(daily.weather_code[index])[0]}">${weatherMeta(daily.weather_code[index])[1]}</span><span class="day-rain">${chance ? `${Math.round(chance)}%` : ""}</span><span class="day-temp"><span class="low">${clampRound(daily.temperature_2m_min[index])}°</span><span>${clampRound(daily.temperature_2m_max[index])}°</span></span>`;
    list.append(row);
  });
}

function renderAdvice(data, hours) {
  const umbrella = buildUmbrellaAdvice(data, hours);
  setText("umbrellaTitle", umbrella.title);
  setText("umbrellaDetail", umbrella.detail);

  const dress = buildDressAdvice(data, hours);
  setText("dressTitle", dress.title);
  setText("dressDetail", dress.detail);
  setText("gentleNote", dress.gentle);
}

function buildUmbrellaAdvice(data, hours) {
  const probabilities = hours.precipitation_probability.map((value) => safeNumber(value));
  const precipitation = hours.precipitation.map((value) => safeNumber(value));
  const maxChance = Math.max(...probabilities, 0);
  const totalRain = precipitation.reduce((sum, value) => sum + value, 0);
  const shortRain = (data.minutely_15?.precipitation || []).map((value) => safeNumber(value));
  const shortTotal = shortRain.reduce((sum, value) => sum + value, 0);
  const firstShortRain = shortRain.findIndex((value) => value >= .1);
  const firstLikelyHour = probabilities.findIndex((value, index) => value >= 50 || precipitation[index] >= .2);

  if (safeNumber(data.current.precipitation) >= .1) {
    return { title: "现在在下雨，记得带伞", detail: maxChance >= 60 ? `未来 12 小时最高降雨概率 ${Math.round(maxChance)}%` : "路面可能湿滑，慢一点走" };
  }
  if (firstShortRain >= 0 && shortTotal >= .1) {
    const minutes = (firstShortRain + 1) * 15;
    return { title: "折叠伞放进包里吧", detail: `短时预报显示约 ${minutes} 分钟后可能有雨` };
  }
  if (maxChance >= 60 || totalRain >= 1) {
    const when = firstLikelyHour > 0 ? `${timePart(hours.time[firstLikelyHour])} 前后` : "接下来";
    return { title: "今天记得带伞", detail: `${when}可能下雨，最高概率 ${Math.round(maxChance)}%` };
  }
  if (maxChance >= 35 || totalRain >= .2) {
    return { title: "带把小伞更安心", detail: `未来 12 小时最高降雨概率 ${Math.round(maxChance)}%` };
  }
  return { title: "今天大概率不用带伞", detail: maxChance ? `未来 12 小时降雨概率最高 ${Math.round(maxChance)}%` : "暂时没有明显降水信号" };
}

function buildDressAdvice(data, hours) {
  const feels = safeNumber(data.current.apparent_temperature);
  const maxWind = Math.max(...hours.wind_speed_10m.map((value) => safeNumber(value)), 0);
  const maxRain = Math.max(...hours.precipitation_probability.map((value) => safeNumber(value)), 0);
  const humidity = safeNumber(data.current.relative_humidity_2m);
  const uv = safeNumber(data.daily.uv_index_max[0]);
  const dayRange = safeNumber(data.daily.temperature_2m_max[0]) - safeNumber(data.daily.temperature_2m_min[0]);
  let title;
  if (feels <= 0) title = "羽绒服和保暖内搭最稳妥";
  else if (feels <= 6) title = "厚外套、毛衣和长裤";
  else if (feels <= 12) title = "外套叠穿一件长袖";
  else if (feels <= 18) title = "薄外套配长袖刚刚好";
  else if (feels <= 23) title = "长袖或轻薄外套都合适";
  else if (feels <= 28) title = "短袖为主，备一件薄外搭";
  else title = "轻薄短袖，尽量穿得透气";

  const details = [];
  if (maxWind >= 25) details.push("风比较大，外套选防风一点的");
  else if (dayRange >= 8) details.push("早晚温差大，外套别忘了");
  if (maxRain >= 40) details.push("鞋子选耐湿、好走的更舒服");
  else if (humidity >= 80 && feels >= 24) details.push("湿度偏高，面料轻薄会更舒服");
  if (uv >= 6) details.push("白天紫外线较强，记得防晒");
  if (!details.length) details.push("体感比较舒服，按平时习惯穿就好");

  const localHour = Number(timePart(data.current.time).split(":")[0]);
  let gentle;
  if (safeNumber(data.current.precipitation) >= .1) gentle = `${PERSON_NAME}，外面在下雨，伞要拿好，别淋湿了。`;
  else if (maxRain >= 40) gentle = `${PERSON_NAME}，把伞带上，天气变了也不慌。`;
  else if (feels <= 8) gentle = `${PERSON_NAME}，今天有点冷，记得把自己裹暖一点。`;
  else if (feels >= 30) gentle = `${PERSON_NAME}，今天很热，出门记得多喝水。`;
  else if (dayRange >= 8) gentle = `${PERSON_NAME}，晚上会比白天凉，回家晚的话带件外套。`;
  else if (uv >= 6) gentle = `${PERSON_NAME}，阳光认真，防晒也要认真。`;
  else if (localHour >= 20 || localHour < 5) gentle = `${PERSON_NAME}，回家路上慢一点，到了就早点休息。`;
  else gentle = `${PERSON_NAME}，天气刚刚好，希望你今天心情也很好。`;
  return { title, detail: details.slice(0, 2).join("；") + "。", gentle };
}

function renderAir(data) {
  if (!data?.current) {
    setText("aqiLevel", "暂时不可用");
    setText("airAdvice", "天气数据仍可正常查看，请稍后再刷新空气质量");
    ["aqiValue", "pm25Value", "pm10Value", "ozoneValue"].forEach((id) => setText(id, "--"));
    $("#aqiOrb").dataset.level = "unknown";
    return;
  }
  const current = data.current;
  const info = aqiInfo(safeNumber(current.us_aqi));
  setText("aqiLevel", info.label);
  setText("airAdvice", info.advice);
  setText("aqiValue", clampRound(current.us_aqi));
  setText("pm25Value", formatOne(current.pm2_5));
  setText("pm10Value", formatOne(current.pm10));
  setText("ozoneValue", formatOne(current.ozone));
  $("#aqiOrb").dataset.level = info.level;
}

function aqiInfo(value) {
  if (value <= 50) return { label: "空气清新", advice: "适合开窗，也适合出门走走", level: "good" };
  if (value <= 100) return { label: "空气尚可", advice: "大多数人可以正常进行户外活动", level: "moderate" };
  if (value <= 150) return { label: "敏感人群留意", advice: "呼吸道敏感时，可以适当缩短户外停留", level: "sensitive" };
  if (value <= 200) return { label: "空气不太理想", advice: "减少长时间户外运动，必要时戴好口罩", level: "unhealthy" };
  return { label: "尽量少在户外停留", advice: "关好窗，外出时做好防护", level: "unhealthy" };
}

function renderUnavailable() {
  setText("conditionText", "天气暂时走丢了");
  setText("umbrellaTitle", "暂时无法判断是否带伞");
  setText("umbrellaDetail", "网络恢复后点右上角刷新试试");
  setText("dressTitle", "先按体感穿衣吧");
  setText("dressDetail", "出门前带件轻便外套，会更安心。");
}

function useGeolocation({ closeDialog = false } = {}) {
  if (!navigator.geolocation) {
    showToast("这个浏览器不支持定位，已显示湖北恩施");
    setText("placeDetail", "浏览器不支持定位 · 当前为默认位置");
    return;
  }
  setText("placeDetail", "正在获取精确位置…");
  const action = $("#locateAction");
  action.disabled = true;
  navigator.geolocation.getCurrentPosition(async (position) => {
    const location = {
      latitude: Number(position.coords.latitude.toFixed(5)),
      longitude: Number(position.coords.longitude.toFixed(5)),
      name: "当前位置",
      admin1: "",
      country: "",
      detail: `定位精度约 ${Math.round(position.coords.accuracy)} 米`,
      source: "gps"
    };
    const named = await reverseGeocode(location).catch(() => location);
    action.disabled = false;
    if (closeDialog && $("#searchDialog").open) $("#searchDialog").close();
    await loadWeather(named);
  }, (error) => {
    action.disabled = false;
    const reason = error.code === 1 ? "未获得定位权限" : error.code === 3 ? "定位超时" : "暂时无法定位";
    const usingDefault = Math.abs(safeNumber(state.location.latitude) - DEFAULT_LOCATION.latitude) < .0001 && Math.abs(safeNumber(state.location.longitude) - DEFAULT_LOCATION.longitude) < .0001;
    setText("placeDetail", usingDefault ? `${reason} · 当前为默认位置` : `${reason} · 已保留当前城市`);
    showToast(usingDefault ? `${reason}，已显示湖北恩施` : `${reason}，已保留${stripSuffix(state.location.name)}`);
  }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 5 * 60 * 1000 });
}

async function reverseGeocode(location) {
  const params = new URLSearchParams({ latitude: location.latitude, longitude: location.longitude, localityLanguage: "zh" });
  const data = await fetchJson(`https://api.bigdatacloud.net/data/reverse-geocode-client?${params}`, 6000);
  const name = data.locality || data.city || data.principalSubdivision || "当前位置";
  const admin1 = data.principalSubdivision || "";
  const country = data.countryName || "";
  const detail = [country, admin1].filter(Boolean).map(cleanPlaceName).filter((item, index, all) => all.indexOf(item) === index).join(" · ");
  return { ...location, name, admin1: admin1 === name ? "" : admin1, country, detail: detail || location.detail };
}

async function searchCities(query) {
  const normalized = query.trim();
  if (normalized.length < 2) {
    setText("searchStatus", "输入至少两个字开始搜索");
    $("#searchResults").replaceChildren();
    return;
  }
  setText("searchStatus", "正在搜索…");
  const params = new URLSearchParams({ q: normalized, format: "jsonv2", addressdetails: "1", namedetails: "1", limit: "10", "accept-language": "zh-CN" });
  try {
    const data = await fetchJson(`https://nominatim.openstreetmap.org/search?${params}`, 9000);
    renderSearchResults(Array.isArray(data) ? data : []);
  } catch (error) {
    setText("searchStatus", "搜索没有成功，请稍后再试");
    $("#searchResults").replaceChildren();
  }
}

function renderSearchResults(results) {
  const container = $("#searchResults");
  container.replaceChildren();
  setText("searchStatus", results.length ? `找到 ${results.length} 个位置` : "没有找到，试试输入完整的城市或区县名");
  results.forEach((result) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "result-button";
    const text = document.createElement("span");
    const title = document.createElement("strong");
    const resultName = cleanPlaceName(result.namedetails?.["name:zh-Hans"] || result.namedetails?.["name:zh"] || result.name || result.display_name?.split(",")[0] || "未命名地点");
    title.textContent = resultName;
    const detail = document.createElement("small");
    const address = result.address || {};
    detail.textContent = [address.country, address.state || address.province || address.region, address.county || address.state_district].filter(Boolean).map(cleanPlaceName).filter((item, index, all) => all.indexOf(item) === index).join(" · ");
    const arrow = document.createElement("small");
    arrow.textContent = "›";
    text.append(title, detail);
    button.append(text, arrow);
    button.addEventListener("click", () => {
      const location = { latitude: Number(result.lat), longitude: Number(result.lon), name: resultName, admin1: address.state || address.province || address.region || "", country: address.country || "", detail: detail.textContent || "全球位置", source: "search" };
      $("#searchDialog").close();
      loadWeather(location);
    });
    container.append(button);
  });
}

function openSearch() {
  const dialog = $("#searchDialog");
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  setTimeout(() => $("#citySearch").focus(), 120);
}

function stripSuffix(value = "") {
  return value.replace(/省$|市$|自治区$|特别行政区$/u, "");
}
function cleanPlaceName(value = "") { const map = { "臺": "台", "灣": "湾", "國": "国", "紐": "纽", "約": "约", "門": "门" }; return value.split(";")[0].split("/")[0].trim().replace(/[臺灣國紐約門]/g, (char) => map[char] || char); }
function timePart(time = "") { return time.includes("T") ? time.split("T")[1].slice(0, 5) : "--:--"; }
function weekDay(date) { return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][new Date(`${date}T12:00:00`).getDay()]; }
function formatOne(value) { return Number.isFinite(Number(value)) ? Number(value).toFixed(Number(value) >= 10 ? 0 : 1).replace(/\.0$/, "") : "--"; }
function greetingText(localTime = "") { const parsed = Number(timePart(localTime).split(":")[0]); const hour = Number.isFinite(parsed) ? parsed : new Date().getHours(); return hour < 6 ? `${PERSON_NAME}，夜深了，早点休息` : hour < 11 ? `${PERSON_NAME}，早上好，今天也要照顾好自己` : hour < 14 ? `${PERSON_NAME}，中午好，记得按时吃饭` : hour < 18 ? `${PERSON_NAME}，下午好，出门前看看天气` : `${PERSON_NAME}，晚上好，回家路上慢一点`; }
function windDirection(degrees) { const names = ["北风", "东北风", "东风", "东南风", "南风", "西南风", "西风", "西北风"]; return names[Math.round(safeNumber(degrees) / 45) % 8]; }
function humidityHint(value) { const number = safeNumber(value); return number >= 85 ? "比较潮湿" : number <= 35 ? "空气偏干" : "体感舒适"; }
function uvHint(value) { const number = safeNumber(value); return number >= 8 ? "尽量避免暴晒" : number >= 6 ? "注意防晒" : number >= 3 ? "适度防晒" : "紫外线较弱"; }

function persistState() {
  try {
    localStorage.setItem("just-right-weather-location", JSON.stringify(state.location));
  } catch (_) { /* 隐私模式下忽略 */ }
}

function savedLocation() {
  try {
    const saved = JSON.parse(localStorage.getItem("just-right-weather-location"));
    return saved && Number.isFinite(Number(saved.latitude)) && Number.isFinite(Number(saved.longitude)) ? saved : null;
  } catch (_) { return null; }
}

function bindEvents() {
  $("#locationButton").addEventListener("click", openSearch);
  $("#closeSearch").addEventListener("click", () => $("#searchDialog").close());
  $("#searchDialog").addEventListener("click", (event) => { if (event.target === $("#searchDialog")) $("#searchDialog").close(); });
  $("#locateAction").addEventListener("click", () => useGeolocation({ closeDialog: true }));
  $("#refreshButton").addEventListener("click", () => loadWeather(state.location));
  $("#citySearch").addEventListener("input", (event) => {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => searchCities(event.target.value), 700);
  });
  $("#quickLocations").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-name]");
    if (!button) return;
    $("#citySearch").value = button.dataset.name;
    searchCities(button.dataset.name);
  });
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.deferredInstall = event;
    $("#installButton").hidden = false;
  });
  $("#installButton").addEventListener("click", async () => {
    if (!state.deferredInstall) return;
    state.deferredInstall.prompt();
    await state.deferredInstall.userChoice;
    state.deferredInstall = null;
    $("#installButton").hidden = true;
  });
  window.addEventListener("appinstalled", () => showToast("已经添加到桌面啦"));
  window.addEventListener("online", () => loadWeather(state.location, { silent: true }));
}

async function init() {
  bindEvents();
  renderLocation(DEFAULT_LOCATION);
  const saved = savedLocation();
  const initial = saved || DEFAULT_LOCATION;
  await loadWeather(initial);
  useGeolocation();
  setInterval(() => loadWeather(state.location, { silent: true }), 15 * 60 * 1000);
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
  }
}

init();
