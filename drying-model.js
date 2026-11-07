(function (root, factory) {
  const model = factory();
  if (typeof module === "object" && module.exports) module.exports = model;
  else root.DryingModel = model;
})(globalThis, function () {
  "use strict";
  const HOUR = 3600000;
  // Product choices, not textile drying standards or calibrated probabilities.
  const POLICY = Object.freeze({ vpdScale: 1, minimumVpd: 0.6, goodVpd: 1.2,
    rainProbability: 40, precipitation: 0.1, wind: 30, gust: 40 });
  const finite = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
  const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const dayKey = (date) => new Date(date.getTime() + 8 * HOUR).toISOString().slice(0, 10);

  function airDeficit(temp, rh) {
    if (!finite(temp, -60, 60) || !finite(rh, 0, 100)) return null;
    return 0.6108 * Math.exp(17.27 * temp / (temp + 237.3)) * (1 - rh / 100);
  }

  function potentialScore(vpd) {
    return Number.isFinite(vpd) && vpd >= 0 ? 100 * vpd / (vpd + POLICY.vpdScale) : null;
  }

  function assessHour(hour) {
    const vpd = airDeficit(hour.temperature, hour.humidity);
    const rawScore = potentialScore(vpd);
    const missing = [];
    if (!finite(hour.temperature, -60, 60)) missing.push("温度");
    if (!finite(hour.humidity, 0, 100)) missing.push("湿度");
    if (!finite(hour.wind, 0, 300)) missing.push("风速");
    if (!finite(hour.gust, 0, 400)) missing.push("阵风");
    if (!finite(hour.precipitation, 0, 500)) missing.push("降水量");
    if (!finite(hour.rainProbability, 0, 100)) missing.push("降雨概率");
    if (![0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 97, 99].includes(hour.weatherCode)) missing.push("天气状况");
    const blockers = [];
    const wet = hour.precipitation >= POLICY.precipitation || hour.weatherCode >= 51;
    const rainWatch = wet || hour.rainProbability >= POLICY.rainProbability;
    if (hour.weatherCode >= 95) blockers.push("有雷暴风险");
    else if ([56, 57, 66, 67, 71, 73, 75, 77, 85, 86].includes(hour.weatherCode)) blockers.push("有冻雨或降雪");
    if (hour.wind >= POLICY.wind || hour.gust >= POLICY.gust) blockers.push("风力偏大");
    if (Number.isFinite(hour.temperature) && hour.temperature <= 0) blockers.push("低温结冰风险");
    const suitable = !missing.length && !blockers.length && vpd >= POLICY.minimumVpd;
    return { ...hour, score: rawScore === null ? null : Math.round(rawScore), rawScore, vpd,
      missing, blockers, rainWatch, suitable };
  }

  function advice(hour) {
    if (!hour) return { text: "数据不足，暂不判断", className: "okay" };
    if (hour.blockers.length) return { text: `${hour.blockers[0]}，暂缓去阳台晾衣`, className: "bad" };
    if (hour.missing.length) return { text: "数据不足，暂不判断", className: "okay" };
    if (hour.suitable && hour.rainWatch) return { text: "可在阳台内侧晾，留意飘雨", className: "okay" };
    if (hour.vpd >= POLICY.goodVpd) return { text: "空气较干，可以在阳台晾", className: "good" };
    if (hour.suitable) return { text: "可以晾，干燥较慢", className: "okay" };
    return { text: "干燥动力弱，建议等等", className: "okay" };
  }

  function makePeriod(hours, now) {
    const start = new Date(Math.max(hours[0].date.getTime(), now));
    const end = hours[hours.length - 1].end;
    const weights = hours.map((hour) => (hour.end - Math.max(hour.date.getTime(), now)) / HOUR);
    const durationHours = weights.reduce((sum, value) => sum + value, 0);
    return { start, end, durationHours, hours,
      average: Math.round(hours.reduce((sum, hour, i) => sum + hour.rawScore * weights[i], 0) / durationHours),
      deficitHours: hours.reduce((sum, hour, i) => sum + hour.vpd * weights[i], 0),
      rainWatch: hours.some((hour) => hour.rainWatch),
      humidityAvg: Math.round(mean(hours.map((hour) => hour.humidity))),
      rainMax: Math.max(...hours.map((hour) => hour.rainProbability)) };
  }

  function findPeriods(hours, limit = 3, now = Date.now()) {
    const periods = [];
    let group = [];
    const flush = () => { if (group.length) periods.push(makePeriod(group, now)); group = []; };
    const sorted = [...hours].sort((a, b) => a.date - b.date);
    for (const hour of sorted) {
      if (!(hour.date instanceof Date) || !(hour.end instanceof Date) ||
          hour.end - hour.date !== HOUR || hour.end.getTime() <= now) { flush(); continue; }
      const previous = group[group.length - 1];
      if (previous && (hour.date.getTime() !== previous.end.getTime() || dayKey(hour.date) !== dayKey(previous.date))) flush();
      if (hour.suitable) group.push(hour);
      else flush();
    }
    flush();
    return periods.slice(0, limit);
  }

  function groupByDay(hours) {
    const days = new Map();
    for (const hour of hours) {
      const key = dayKey(hour.date);
      if (!days.has(key)) days.set(key, []);
      days.get(key).push(hour);
    }
    return days;
  }
  return { HOUR, POLICY, finite, dayKey, potentialScore, assessHour, advice, findPeriods, groupByDay };
});
