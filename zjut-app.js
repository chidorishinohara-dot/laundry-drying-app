"use strict";
const M = DryingModel;
const state = { weather: null, lastLoadedAt: null, loading: false };
const els = Object.fromEntries(["refreshButton", "scoreRing", "scoreValue", "mainAdvice", "summaryText",
  "conditions", "windowList", "dailyList", "hourlyList", "currentText", "sourceText", "confidenceText",
  "locationLabel", "updatedAt", "humidityMetric", "windMetric", "rainMetric", "tempMetric"]
  .map((id) => [id, document.getElementById(id)]));
const number = (value, digits = 0) => Number.isFinite(value) ? value.toFixed(digits) : "--";
const format = (date, options) => new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", ...options }).format(date);
const formatHour = (date) => format(date, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const formatDay = (date) => format(date, { weekday: "short", month: "numeric", day: "numeric" });
const formatDateTime = (date) => format(date, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const periodTime = (period) => `${formatHour(period.start)}-${M.dayKey(period.end) !== M.dayKey(period.start) ? "次日 " : ""}${formatHour(period.end)}`;
const periodDuration = (period) => period.durationHours < 1
  ? `${Math.max(1, Math.ceil(period.durationHours * 60))} 分钟` : `${number(period.durationHours, 1)} 小时`;

function distanceKm(from, to) {
  if (![to?.latitude, to?.longitude].every(Number.isFinite)) return null;
  const rad = (value) => value * Math.PI / 180;
  const a = Math.sin(rad(to.latitude - from.latitude) / 2) ** 2 +
    Math.cos(rad(from.latitude)) * Math.cos(rad(to.latitude)) * Math.sin(rad(to.longitude - from.longitude) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

function currentAssessment(hour, current, now) {
  if (!hour || !current || Math.abs(now - current.date.getTime()) > 90 * 60000) return hour;
  // The score remains an hourly forecast proxy; current rain/wind can veto advice.
  const maximum = (a, b) => Number.isFinite(a) && Number.isFinite(b) ? Math.max(a, b) : null;
  return M.assessHour({ ...hour, temperature: current.temperature, humidity: current.humidity,
    wind: maximum(hour.wind, current.wind), gust: maximum(hour.gust, current.gust),
    precipitation: maximum(hour.precipitation, current.precipitation),
    weatherCode: maximum(hour.weatherCode, current.weatherCode) });
}

function render() {
  const now = Date.now();
  const { current, grid } = state.weather;
  const hours = state.weather.hours.filter((hour) => hour.end.getTime() > now).map(M.assessHour);
  if (!hours.length) { setError(new Error("预报已过期")); return; }
  const first = hours.find((hour) => hour.date.getTime() <= now && hour.end.getTime() > now);
  const freshCurrent = current && Math.abs(now - current.date.getTime()) <= 90 * 60000 ? current : null;
  const assessed = currentAssessment(first, freshCurrent, now);
  if (first && assessed) hours[hours.indexOf(first)] = assessed;
  const advice = M.advice(assessed);
  const periods = M.findPeriods(hours, 3, now);
  const score = assessed?.score;
  els.scoreValue.textContent = score ?? "--";
  els.scoreRing.style.background = `conic-gradient(var(--${advice.className === "good" ? "green" : advice.className === "bad" ? "red" : "amber"}) ${(score ?? 0) * 3.6}deg, rgba(255,255,255,.15) 0deg)`;
  els.mainAdvice.textContent = freshCurrent || !assessed ? advice.text : "仅有小时预报，现场天气待确认";
  els.mainAdvice.className = advice.className;
  els.summaryText.textContent = assessed?.score == null
    ? "缺少本小时干燥参考数据，不生成分数。"
    : `本小时 ${formatHour(assessed.date)}-${formatHour(assessed.end)} 的天气参考，不代表干透概率。${assessed.suitable ? "能否干透，还取决于脱水程度、衣物间距和实际通风。" : "可先等条件改善，再安排室外晾晒。"}`;
  const rainText = assessed?.blockers.filter((item) => /雨|水|雷/.test(item)).join("、") ||
    (M.finite(assessed?.rainProbability, 0, 100) && M.finite(assessed?.precipitation, 0, 500) ? `本小时降雨概率 ${assessed.rainProbability}%` : "降雨数据不足");
  els.conditions.innerHTML = `
    <div><span>干燥动力</span><strong>${score == null ? "待判断" : score >= 71 ? "较强" : score >= 39 ? "中等" : "偏弱"}</strong></div>
    <div><span>淋雨风险</span><strong>${rainText}</strong></div>
    <div><span>干透判断</span><strong>尚未实测校准，不估计小时数</strong></div>`;
  if (assessed?.missing.length) els.summaryText.textContent += ` 缺少：${assessed.missing.join("、")}。`;
  els.locationLabel.textContent = "未来三个 · 北京时间";
  els.updatedAt.textContent = freshCurrent ? `当前估计 ${formatDateTime(freshCurrent.date)}` : "当前数据缺失或过时";
  const dist = distanceKm(WeatherProvider.CAMPUS, grid);
  els.sourceText.textContent = `Open-Meteo 网格预报，不是校内气象站观测${dist == null ? "" : `；返回网格中心约距校区 ${dist.toFixed(1)} km`}。`;
  els.confidenceText.textContent = `v17 · ${formatDateTime(new Date(state.lastLoadedAt))} 获取；未经校区衣物实测校准。`;
  els.humidityMetric.textContent = `${number(freshCurrent?.humidity)}%`;
  els.windMetric.textContent = `${number(freshCurrent?.wind)} km/h`;
  els.rainMetric.textContent = `${number(freshCurrent?.precipitation, 2)} mm`;
  els.tempMetric.textContent = `${number(freshCurrent?.temperature, 1)}℃`;
  els.currentText.textContent = `本小时参考蒸散量 ${number(assessed?.et0, 2)} mm，空气水汽压差 ${number(assessed?.vpd, 2)} kPa。湿度不能单独决定干燥快慢；日照和通风也有影响。${freshCurrent?.humidity >= 85 ? "当前空气偏湿，背阴或通风不良处可能更慢。" : ""}`;

  els.windowList.innerHTML = periods.length ? periods.map((period, index) => `
    <div class="window-card">
      <strong>${index === 0 ? "下一个" : "备选"}：${formatDay(period.start)} ${periodTime(period)}</strong>
      <p>可晾约 ${periodDuration(period)} · 条件参考 ${period.average} 分<br>湿度约 ${period.humidityAvg}% · 最高降雨概率 ${period.rainMax}%${period.start - now > 48 * M.HOUR ? "<br>远期预报，临近再确认" : ""}</p>
    </div>`).join("") : '<p class="muted">未来 7 天未找到符合当前筛选条件的时段，不代表完全不能晾干。</p>';

  els.dailyList.innerHTML = [...M.groupByDay(hours).values()].slice(0, 7).map((dayHours) => {
    const dayPeriods = M.findPeriods(dayHours, Infinity, now);
    const best = [...dayPeriods].sort((a, b) => b.et0Total - a.et0Total || a.start - b.start)[0];
    const validTemps = dayHours.map((hour) => hour.temperature).filter((value) => M.finite(value, -60, 60));
    const incomplete = dayHours.some((hour) => hour.missing.length);
    const temps = validTemps.length ? `${number(Math.min(...validTemps))}-${number(Math.max(...validTemps))}℃` : "温度数据不足";
    return `<div class="day-card"><div><strong>${formatDay(dayHours[0].date)}</strong><span class="${best ? "good" : "okay"}">${best ? "有可晾时段" : incomplete ? "数据不足，暂不判断" : "暂无推荐时段"}</span></div>
      <p>${temps}${incomplete ? " · 部分数据缺失" : ""}${dayHours[0].date - now > 48 * M.HOUR ? " · 远期参考" : ""}</p>
      <em>${dayPeriods.length ? dayPeriods.map(periodTime).join("，") : "没有找到低风险且干燥动力足够的连续时段"}</em>
      ${best ? `<p>优先 ${periodTime(best)} · 不保证在此期间干透</p>` : ""}</div>`;
  }).join("");

  els.hourlyList.innerHTML = hours.slice(0, 24).map((hour) => {
    const humidity = M.finite(hour.humidity, 0, 100) ? hour.humidity : null;
    const rowAdvice = M.advice(hour);
    return `<div class="hour"><time datetime="${hour.date.toISOString()}"><span>${format(hour.date, { month: "numeric", day: "numeric" })}</span>${formatHour(hour.date)}</time>
      <strong class="${rowAdvice.className}" title="${rowAdvice.text}" aria-label="干燥参考 ${hour.score ?? "未知"} 分；${rowAdvice.text}">${hour.score ?? "--"}</strong>
      <div class="humidity-bar" aria-label="湿度 ${humidity ?? "未知"}%"><span style="width:${humidity ?? 0}%"></span></div><em>${humidity ?? "--"}%</em></div>`;
  }).join("");
}

function clearReadings() {
  for (const key of ["scoreValue", "humidityMetric", "windMetric", "rainMetric", "tempMetric", "updatedAt"]) els[key].textContent = "--";
  els.scoreRing.style.background = "rgba(255,255,255,.15)";
  els.conditions.innerHTML = "";
  els.hourlyList.innerHTML = "";
}

function setError(error) {
  state.weather = null;
  state.lastLoadedAt = null;
  clearReadings();
  els.mainAdvice.textContent = "暂时无法生成建议";
  els.mainAdvice.className = "bad";
  els.summaryText.textContent = `${error.message}。请稍后刷新。`;
  els.windowList.innerHTML = '<p class="muted">没有可用天气数据。</p>';
  els.dailyList.innerHTML = '<p class="muted">没有可用 7 天预报。</p>';
  els.currentText.textContent = "没有可用当前天气，不显示旧分数。";
  els.sourceText.textContent = "Open-Meteo 天气数据尚未成功读取。";
  els.confidenceText.textContent = "数据不足，暂不判断。";
}

async function load() {
  if (state.loading) return;
  state.loading = true;
  els.refreshButton.disabled = true;
  clearReadings();
  els.mainAdvice.textContent = "正在读取天气";
  els.mainAdvice.className = "";
  els.summaryText.textContent = "正在核对干燥条件和降雨风险。";
  els.windowList.innerHTML = '<p class="muted">正在准备建议。</p>';
  els.dailyList.innerHTML = '<p class="muted">正在读取预报。</p>';
  els.currentText.textContent = "正在读取当前天气估计。";
  els.confidenceText.textContent = "正在获取新数据。";
  try {
    state.weather = await WeatherProvider.fetchWeather();
    state.lastLoadedAt = Date.now();
    render();
  } catch (error) { setError(error); }
  finally { state.loading = false; els.refreshButton.disabled = false; }
}

els.refreshButton.addEventListener("click", load);
document.querySelectorAll(".tab").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((tab) => {
      tab.classList.toggle("active", tab === button);
      tab.setAttribute("aria-selected", String(tab === button));
    });
    document.querySelectorAll(".tab-panel").forEach((panel) => {
      panel.hidden = panel.dataset.panel !== button.dataset.view;
      panel.classList.toggle("active", !panel.hidden);
    });
  });
});
load();
setInterval(() => { if (document.visibilityState === "visible") load(); }, M.HOUR);
setInterval(() => { if (!state.loading && state.weather && document.visibilityState === "visible") render(); }, 60000);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  if (!state.lastLoadedAt || Date.now() - state.lastLoadedAt > 30 * 60000) load();
  else if (state.weather) render();
});
if ("serviceWorker" in navigator) window.addEventListener("load", () => {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
});
