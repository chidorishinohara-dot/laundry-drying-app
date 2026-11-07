(function (root, factory) {
  const provider = factory();
  if (typeof module === "object" && module.exports) module.exports = provider;
  else root.WeatherProvider = provider;
})(globalThis, function () {
  "use strict";
  const HOUR = 3600000;
  const CAMPUS = Object.freeze({ name: "浙江工业大学朝晖校区", latitude: 30.292937, longitude: 120.165978 });
  const valueAt = (data, key, i) => data[key]?.[i] ?? null;
  const maximum = (a, b) => Number.isFinite(a) && Number.isFinite(b) ? Math.max(a, b) : null;

  function forecastUrl() {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.search = new URLSearchParams({ latitude: CAMPUS.latitude, longitude: CAMPUS.longitude,
      timezone: "Asia/Shanghai", timeformat: "unixtime", forecast_days: "8",
      wind_speed_unit: "kmh", precipitation_unit: "mm", temperature_unit: "celsius",
      current: "temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m",
      hourly: "temperature_2m,relative_humidity_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m"
    }).toString();
    return url;
  }

  function parseWeather(data, now = Date.now()) {
    const source = data.hourly;
    const units = data.hourly_units;
    if (!Array.isArray(source?.time) || units?.time !== "unixtime" ||
        units.wind_speed_10m !== "km/h" ||
        units.precipitation !== "mm" || units.temperature_2m !== "°C" ||
        units.relative_humidity_2m !== "%" || units.precipitation_probability !== "%" ||
        units.wind_gusts_10m !== "km/h") throw new Error("天气数据格式或单位不完整");
    const localMidnight = Math.floor((now + 8 * HOUR) / (24 * HOUR)) * 24 * HOUR - 8 * HOUR;
    const cutoff = localMidnight + 7 * 24 * HOUR;
    const hours = [];
    // Aggregates at T describe [T-1h, T), unlike instantaneous temperature/RH.
    for (let i = 1; i < source.time.length; i++) {
      const start = source.time[i - 1] * 1000;
      const end = source.time[i] * 1000;
      if (!Number.isFinite(start) || !Number.isFinite(end) || end - start !== HOUR || end <= now || start >= cutoff) continue;
      hours.push({ date: new Date(start), end: new Date(end),
        temperature: valueAt(source, "temperature_2m", i - 1),
        humidity: valueAt(source, "relative_humidity_2m", i - 1),
        wind: maximum(valueAt(source, "wind_speed_10m", i - 1), valueAt(source, "wind_speed_10m", i)),
        gust: valueAt(source, "wind_gusts_10m", i),
        weatherCode: maximum(valueAt(source, "weather_code", i - 1), valueAt(source, "weather_code", i)),
        rainProbability: valueAt(source, "precipitation_probability", i),
        precipitation: valueAt(source, "precipitation", i)
      });
    }
    if (!hours.length) throw new Error("没有有效的未来小时预报");
    const current = data.current && Number.isFinite(data.current.time) ? {
      date: new Date(data.current.time * 1000), temperature: data.current.temperature_2m ?? null,
      humidity: data.current.relative_humidity_2m ?? null, precipitation: data.current.precipitation ?? null,
      weatherCode: data.current.weather_code ?? null, wind: data.current.wind_speed_10m ?? null,
      gust: data.current.wind_gusts_10m ?? null
    } : null;
    return { current, hours, grid: { latitude: data.latitude, longitude: data.longitude } };
  }

  async function fetchWeather() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(forecastUrl(), { signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw new Error(`天气服务暂不可用（${response.status}）`);
      return parseWeather(await response.json());
    } catch (error) {
      if (error.name === "AbortError") throw new Error("天气请求超时");
      throw error;
    } finally { clearTimeout(timer); }
  }
  return { CAMPUS, forecastUrl, parseWeather, fetchWeather };
});
