const CAMPUS = {
  name: "浙江工业大学朝晖校区",
  latitude: 30.292937,
  longitude: 120.165978
};

const weatherCodeText = {
  0: "晴",
  1: "大致晴朗",
  2: "局部多云",
  3: "阴",
  45: "雾",
  48: "霜雾",
  51: "小毛毛雨",
  53: "毛毛雨",
  55: "较强毛毛雨",
  61: "小雨",
  63: "雨",
  65: "大雨",
  80: "阵雨",
  81: "阵雨",
  82: "强阵雨",
  95: "雷雨"
};

const state = {
  current: null,
  grid: null,
  hours: [],
  lastLoadedAt: null
};

const els = {
  statusPanel: document.querySelector(".status-panel"),
  refreshButton: document.querySelector("#refreshButton"),
  tabs: [...document.querySelectorAll(".tab")],
  panels: [...document.querySelectorAll(".tab-panel")],
  scoreRing: document.querySelector("#scoreRing"),
  scoreValue: document.querySelector("#scoreValue"),
  mainAdvice: document.querySelector("#mainAdvice"),
  summaryText: document.querySelector("#summaryText"),
  windowList: document.querySelector("#windowList"),
  dailyList: document.querySelector("#dailyList"),
  hourlyList: document.querySelector("#hourlyList"),
  currentText: document.querySelector("#currentText"),
  sourceText: document.querySelector("#sourceText"),
  confidenceText: document.querySelector("#confidenceText"),
  updateText: document.querySelector("#updateText"),
  locationLabel: document.querySelector("#locationLabel"),
  updatedAt: document.querySelector("#updatedAt"),
  humidityMetric: document.querySelector("#humidityMetric"),
  windMetric: document.querySelector("#windMetric"),
  rainMetric: document.querySelector("#rainMetric"),
  tempMetric: document.querySelector("#tempMetric")
};

function scoreHour(hour) {
  const vpd = vaporPressureDeficit(hour.temperature, hour.humidity);
  const radiation = hour.radiation ?? 0;
  const reasons = [];
  const vpdScore = smoothstep(0.35, 1.6, vpd);
  const radiationScore = hour.isDay ? smoothstep(80, 720, radiation) : 0;
  const windScore = smoothstep(2, 16, Math.min(hour.wind, 28));
  const tempScore = smoothstep(12, 30, hour.temperature);
  const rainRisk = Math.max(
    smoothstep(20, 70, hour.rainProbability),
    smoothstep(0.05, 0.8, hour.precipitation)
  );
  const humidityDrag = smoothstep(78, 96, hour.humidity);
  const highWindDrag = smoothstep(28, 45, hour.wind);
  const nightFactor = hour.isDay ? 1 : 0.24;
  const rainFactor = clamp(1 - rainRisk * 0.9, 0.04, 1);
  const humidityFactor = clamp(1 - humidityDrag * 0.58, 0.32, 1);
  const windFactor = clamp(1 - highWindDrag * 0.38, 0.62, 1);
  const basePotential = 0.4 * vpdScore + 0.26 * radiationScore + 0.2 * windScore + 0.14 * tempScore;
  const dryingRate = basePotential * rainFactor * humidityFactor * windFactor * nightFactor;
  const score = Math.round(clamp(dryingRate * 100, 0, 100));

  if (rainRisk >= 0.65) reasons.push("降雨会中断晾晒");
  else if (rainRisk >= 0.28) reasons.push("有降雨风险");

  if (vpd < 0.45) reasons.push("空气接近饱和");
  else if (vpd >= 1.2) reasons.push("蒸发拉力强");
  else if (vpd >= 0.75) reasons.push("蒸发拉力尚可");

  if (radiationScore >= 0.65) reasons.push("日照明显");
  else if (hour.isDay && radiationScore < 0.22) reasons.push("日照弱");

  if (hour.wind < 4) reasons.push("风弱");
  else if (hour.wind <= 24) reasons.push("通风可用");
  else reasons.push("风偏大");

  if (hour.humidity >= 88) reasons.push("湿度很高");

  return {
    ...hour,
    vpd: Math.round(vpd * 100) / 100,
    radiation,
    dryingRate: Math.round(dryingRate * 100) / 100,
    score,
    reasons
  };
}

function getAdvice(score) {
  if (score >= 72) return { text: "很适合晾晒", className: "good" };
  if (score >= 56) return { text: "可以晾晒", className: "okay" };
  if (score >= 38) return { text: "干得慢，只适合少量", className: "okay" };
  return { text: "不建议晾晒", className: "bad" };
}

function formatHour(date) {
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatDay(date) {
  return new Intl.DateTimeFormat("zh-CN", { weekday: "short", month: "numeric", day: "numeric" }).format(date);
}

function formatDateTime(date) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function distanceKm(from, to) {
  const earthRadiusKm = 6371;
  const toRad = (degree) => degree * Math.PI / 180;
  const dLat = toRad(to.latitude - from.latitude);
  const dLon = toRad(to.longitude - from.longitude);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(from.latitude)) * Math.cos(toRad(to.latitude)) *
    Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(a));
}

function saturationVaporPressure(tempC) {
  return 0.6108 * Math.exp((17.27 * tempC) / (tempC + 237.3));
}

function vaporPressureDeficit(tempC, humidity) {
  return saturationVaporPressure(tempC) * (1 - humidity / 100);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function smoothstep(edge0, edge1, value) {
  const x = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return x * x * (3 - 2 * x);
}

function average(values) {
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function averageFixed(values, digits = 1) {
  const factor = 10 ** digits;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * factor) / factor;
}

function sumFixed(values, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(values.reduce((sum, value) => sum + value, 0) * factor) / factor;
}

function isSuitableHour(hour) {
  return hour.isDay &&
    hour.dryingRate >= 0.38 &&
    hour.score >= 38 &&
    hour.rainProbability < 45 &&
    hour.precipitation <= 0.15;
}

function makePeriod(hours) {
  const rainMax = Math.max(...hours.map((hour) => hour.rainProbability));
  return {
    start: hours[0].date,
    end: new Date(hours[hours.length - 1].date.getTime() + 60 * 60 * 1000),
    average: average(hours.map((hour) => hour.score)),
    lowest: Math.min(...hours.map((hour) => hour.score)),
    rainMax,
    humidityAvg: average(hours.map((hour) => hour.humidity)),
    windAvg: average(hours.map((hour) => hour.wind)),
    vpdAvg: averageFixed(hours.map((hour) => hour.vpd), 2),
    radiationAvg: average(hours.map((hour) => hour.radiation ?? 0)),
    dryingTotal: sumFixed(hours.map((hour) => hour.dryingRate), 1),
    durationHours: hours.length,
    hours
  };
}

function findPeriods(hours, limit = 6) {
  const periods = [];
  let current = [];

  for (const hour of hours) {
    if (isSuitableHour(hour)) {
      current.push(hour);
    } else if (current.length) {
      periods.push(makePeriod(current));
      current = [];
    }
  }

  if (current.length) periods.push(makePeriod(current));

  return periods
    .filter((period) => period.durationHours >= 1 && period.dryingTotal >= 0.45)
    .sort((a, b) => a.start - b.start)
    .slice(0, limit);
}

function getPeriodDryingText(period) {
  if (!period) return "没有可用晾晒窗口";
  if (period.dryingTotal >= 3.2) return "日常衣物大概率能晒干";
  if (period.dryingTotal >= 2) return "薄衣物可晒干，厚衣偏慢";
  if (period.dryingTotal >= 1.2) return "适合补晒或少量薄衣";
  return "时间偏短，更像补晒窗口";
}

function getBestPeriodForDay(dayHours) {
  return findPeriods(dayHours, 24).sort((a, b) => b.average - a.average || b.durationHours - a.durationHours || a.start - b.start)[0];
}

function groupByDay(hours) {
  return hours.reduce((days, hour) => {
    const key = hour.date.toISOString().slice(0, 10);
    if (!days.has(key)) days.set(key, []);
    days.get(key).push(hour);
    return days;
  }, new Map());
}

function getConfidence(nextWindow, current) {
  if (!nextWindow || !current) {
    return { label: "低", className: "bad", reason: "缺少当前天气或可用晾晒窗口" };
  }

  const startsSoon = nextWindow.start.getTime() - Date.now() <= 4 * 60 * 60 * 1000;
  const currentRainRisk = current.precipitation > 0.1 || current.rain > 0.1 || current.weatherCode >= 51;
  const humidNow = current.humidity >= 82;
  const windyNow = current.wind > 35;

  if (currentRainRisk || windyNow) {
    return { label: "低", className: "bad", reason: currentRainRisk ? "当前已有降水迹象" : "当前风速过大" };
  }

  if (humidNow || nextWindow.rainMax >= 35 || !startsSoon) {
    return {
      label: "中",
      className: "okay",
      reason: humidNow ? "当前湿度偏高" : nextWindow.rainMax >= 35 ? "窗口期降雨概率偏高" : "适合时段不是马上到来"
    };
  }

  return { label: "高", className: "good", reason: "当前条件和短时预报一致" };
}

function makeCurrentHour(current, fallbackHour) {
  if (!current) return fallbackHour;
  return {
    ...fallbackHour,
    ...current,
    rainProbability: fallbackHour.rainProbability ?? 0,
    precipitation: Math.max(current.precipitation ?? 0, current.rain ?? 0, fallbackHour.precipitation ?? 0)
  };
}

function render() {
  if (!state.hours.length) return;

  const scoredHours = state.hours.map(scoreHour);
  const nowHour = scoredHours[0];
  const currentHour = makeCurrentHour(state.current, nowHour);
  const scoredCurrent = scoreHour(currentHour);
  const periods = findPeriods(scoredHours, 3);
  const nextPeriod = periods[0];
  const ringScore = scoredCurrent.score;
  const advice = getAdvice(ringScore);
  const confidence = getConfidence(nextPeriod, state.current);
  const gridDistance = state.grid ? distanceKm(CAMPUS, state.grid) : null;
  const nextDryingText = getPeriodDryingText(nextPeriod);

  els.scoreValue.textContent = ringScore;
  els.scoreRing.style.background = `conic-gradient(${ringScore >= 72 ? "#227a4f" : ringScore >= 38 ? "#a66800" : "#b83a2e"} ${ringScore * 3.6}deg, #ece7dc 0deg)`;
  els.mainAdvice.textContent = advice.text;
  els.mainAdvice.className = advice.className;
  els.statusPanel.classList.remove("good-bg", "okay-bg", "bad-bg");
  els.statusPanel.classList.add(ringScore >= 72 ? "good-bg" : ringScore >= 38 ? "okay-bg" : "bad-bg");
  els.locationLabel.textContent = `${CAMPUS.latitude}, ${CAMPUS.longitude}`;
  els.updatedAt.textContent = state.current ? `实况 ${formatDateTime(state.current.date)}` : `更新 ${formatDateTime(new Date())}`;
  els.sourceText.textContent = gridDistance
    ? `数据源：Open-Meteo 当前估计 + 7 天小时预报，最近网格约 ${gridDistance.toFixed(1)} km`
    : "数据源：Open-Meteo 当前估计 + 7 天小时预报";
  els.confidenceText.textContent = `可信度：${confidence.label}，${confidence.reason}`;
  els.confidenceText.className = confidence.className;

  const current = state.current || nowHour;
  els.humidityMetric.textContent = `${current.humidity}%`;
  els.windMetric.textContent = `${Math.round(current.wind)} km/h`;
  els.rainMetric.textContent = current.rainProbability == null ? `${current.precipitation ?? 0} mm` : `${current.rainProbability}%`;
  els.tempMetric.textContent = `${Math.round(current.temperature)}℃`;
  els.currentText.textContent = `${weatherCodeText[current.weatherCode] || "天气变化"}，湿度 ${current.humidity}%，VPD ${scoredCurrent.vpd} kPa，干燥强度 ${scoredCurrent.dryingRate.toFixed(2)}。${scoredCurrent.reasons.slice(0, 3).join("，") || "当前条件较稳定"}。`;
  els.updateText.textContent = `算法改为连续干燥模型：先估算每小时干燥强度，再看一段时间累计是否足够日常衣物；降雨会直接压低可信度。打开或刷新时会读取最新天气。`;

  if (nextPeriod) {
    els.summaryText.textContent = `现在指数 ${ringScore} 分：${advice.text}。下一个窗口是 ${formatDay(nextPeriod.start)} ${formatHour(nextPeriod.start)}-${formatHour(nextPeriod.end)}，${nextDryingText}。`;
  } else {
    els.summaryText.textContent = `现在指数 ${ringScore} 分：${advice.text}。未来 7 天没有稳定的白天晾晒窗口，先别安排大件清洗。`;
  }

  els.windowList.innerHTML = periods.length
    ? periods.slice(0, 3).map((item, index) => {
        const label = index === 0 ? "下一个" : "备选";
        return `
          <div class="window-card">
            <strong>${label}：${formatDay(item.start)} ${formatHour(item.start)}-${formatHour(item.end)} · 约 ${item.durationHours} 小时</strong>
            <p>${item.average}分，累计干燥 ${item.dryingTotal.toFixed(1)}，${getPeriodDryingText(item)}。VPD ${item.vpdAvg} kPa，湿度约 ${item.humidityAvg}%，最高降雨概率 ${item.rainMax}%。</p>
          </div>
        `;
      }).join("")
    : `<p class="muted">未来 7 天暂时没有稳定晾晒时段。</p>`;

  const dailyItems = [...groupByDay(scoredHours).values()].slice(0, 7).map((dayHours) => {
    const dayPeriods = findPeriods(dayHours, 12);
    const dayPeriod = getBestPeriodForDay(dayHours);
    const dayScore = dayPeriod ? dayPeriod.average : Math.max(...dayHours.map((hour) => hour.score));
    const dayAdvice = getAdvice(dayScore);
    const rainMax = Math.max(...dayHours.map((hour) => hour.rainProbability));
    const humidityAvg = average(dayHours.map((hour) => hour.humidity));
    const tempMin = Math.round(Math.min(...dayHours.map((hour) => hour.temperature)));
    const tempMax = Math.round(Math.max(...dayHours.map((hour) => hour.temperature)));
    const periodText = dayPeriods.length
      ? dayPeriods.map((period) => `${formatHour(period.start)}-${formatHour(period.end)}`).join("，")
      : "暂无";
    const dryingText = dayPeriod ? getPeriodDryingText(dayPeriod) : "不适合安排清洗";

    return `
      <div class="day-card">
        <div>
          <strong>${formatDay(dayHours[0].date)}</strong>
          <span class="${dayAdvice.className}">${dayAdvice.text}</span>
        </div>
        <p>${tempMin}-${tempMax}℃ · 湿度 ${humidityAvg}% · 最高 ${rainMax}% 雨</p>
        <em>${dryingText} · 合适：${periodText}</em>
      </div>
    `;
  });

  els.dailyList.innerHTML = dailyItems.join("");

  els.hourlyList.innerHTML = scoredHours.slice(0, 24).map((hour) => {
    const hourAdvice = getAdvice(hour.score);
    const humidityLevel = Math.max(8, Math.min(100, hour.humidity));
    return `
      <div class="hour">
        <time>${formatHour(hour.date)}</time>
        <strong class="${hourAdvice.className}">${hour.score}</strong>
        <div class="humidity-bar" aria-label="湿度 ${hour.humidity}%">
          <span style="width: ${humidityLevel}%"></span>
        </div>
        <em>${hour.humidity}%</em>
      </div>
    `;
  }).join("");
}

async function fetchWeather() {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", CAMPUS.latitude);
  url.searchParams.set("longitude", CAMPUS.longitude);
  url.searchParams.set("timezone", "Asia/Shanghai");
  url.searchParams.set("forecast_days", "7");
  url.searchParams.set("current", [
    "temperature_2m",
    "relative_humidity_2m",
    "apparent_temperature",
    "is_day",
    "precipitation",
    "rain",
    "weather_code",
    "cloud_cover",
    "wind_speed_10m"
  ].join(","));
  url.searchParams.set("hourly", [
    "temperature_2m",
    "relative_humidity_2m",
    "precipitation_probability",
    "precipitation",
    "weather_code",
    "cloud_cover",
    "shortwave_radiation",
    "wind_speed_10m",
    "is_day"
  ].join(","));

  const response = await fetch(url);
  if (!response.ok) throw new Error("天气读取失败");
  const data = await response.json();
  const currentTime = Date.now();

  const current = data.current ? {
    date: new Date(data.current.time),
    temperature: data.current.temperature_2m,
    feelsLike: data.current.apparent_temperature,
    humidity: data.current.relative_humidity_2m,
    precipitation: data.current.precipitation ?? 0,
    rain: data.current.rain ?? 0,
    weatherCode: data.current.weather_code,
    cloudCover: data.current.cloud_cover,
    wind: data.current.wind_speed_10m,
    isDay: Boolean(data.current.is_day)
  } : null;

  const hours = data.hourly.time.map((time, index) => ({
    date: new Date(time),
    temperature: data.hourly.temperature_2m[index],
    humidity: data.hourly.relative_humidity_2m[index],
    rainProbability: data.hourly.precipitation_probability[index] ?? 0,
    precipitation: data.hourly.precipitation[index] ?? 0,
    weatherCode: data.hourly.weather_code[index],
    weatherText: weatherCodeText[data.hourly.weather_code[index]] || "天气变化",
    cloudCover: data.hourly.cloud_cover[index] ?? 50,
    radiation: data.hourly.shortwave_radiation[index] ?? 0,
    wind: data.hourly.wind_speed_10m[index],
    isDay: Boolean(data.hourly.is_day[index])
  })).filter((hour) => hour.date.getTime() >= currentTime - 60 * 60 * 1000);

  return {
    current,
    grid: {
      latitude: data.latitude,
      longitude: data.longitude
    },
    hours
  };
}

function setLoading() {
  els.mainAdvice.textContent = "正在读取朝晖校区天气";
  els.summaryText.textContent = "正在分析当前天气和未来 7 天的湿度、风速、降雨概率。";
  els.windowList.innerHTML = `<p class="muted">请稍等。</p>`;
  els.dailyList.innerHTML = `<p class="muted">正在读取 7 天预报。</p>`;
  els.currentText.textContent = "正在读取当前实况估计。";
  els.sourceText.textContent = "数据源：Open-Meteo 当前估计 + 7 天小时预报";
  els.confidenceText.textContent = "可信度：计算中";
}

function setError(error) {
  els.mainAdvice.textContent = "暂时无法生成建议";
  els.mainAdvice.className = "bad";
  els.summaryText.textContent = `${error.message}。请检查网络后刷新。`;
  els.windowList.innerHTML = `<p class="muted">没有可用天气数据。</p>`;
  els.dailyList.innerHTML = `<p class="muted">没有可用 7 天预报。</p>`;
  els.currentText.textContent = "没有可用当前天气。";
  els.confidenceText.textContent = "可信度：低";
  els.confidenceText.className = "bad";
}

async function load() {
  try {
    setLoading();
    const weather = await fetchWeather();
    state.current = weather.current;
    state.grid = weather.grid;
    state.hours = weather.hours;
    state.lastLoadedAt = Date.now();
    render();
  } catch (error) {
    setError(error);
  }
}

els.refreshButton.addEventListener("click", load);

els.tabs.forEach((button) => {
  button.addEventListener("click", () => {
    const view = button.dataset.view;
    els.tabs.forEach((tab) => {
      const isActive = tab === button;
      tab.classList.toggle("active", isActive);
      tab.setAttribute("aria-selected", String(isActive));
    });
    els.panels.forEach((panel) => {
      const isActive = panel.dataset.panel === view;
      panel.classList.toggle("active", isActive);
      panel.hidden = !isActive;
    });
  });
});

load();

setInterval(load, 60 * 60 * 1000);

document.addEventListener("visibilitychange", () => {
  const stale = !state.lastLoadedAt || Date.now() - state.lastLoadedAt > 30 * 60 * 1000;
  if (document.visibilityState === "visible" && stale) load();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
