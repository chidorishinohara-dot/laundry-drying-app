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

const clothingProfiles = {
  light: { label: "薄衣服", neededHours: 2, extraHours: 0 },
  normal: { label: "日常衣物", neededHours: 3, extraHours: 1 },
  heavy: { label: "厚衣物/床品", neededHours: 4, extraHours: 2 }
};

const state = {
  clothingType: "normal",
  place: null,
  hours: []
};

const els = {
  refreshButton: document.querySelector("#refreshButton"),
  searchButton: document.querySelector("#searchButton"),
  locationInput: document.querySelector("#locationInput"),
  segments: [...document.querySelectorAll(".segment")],
  scoreRing: document.querySelector("#scoreRing"),
  scoreValue: document.querySelector("#scoreValue"),
  mainAdvice: document.querySelector("#mainAdvice"),
  summaryText: document.querySelector("#summaryText"),
  windowList: document.querySelector("#windowList"),
  hourlyList: document.querySelector("#hourlyList"),
  locationLabel: document.querySelector("#locationLabel"),
  updatedAt: document.querySelector("#updatedAt"),
  humidityMetric: document.querySelector("#humidityMetric"),
  windMetric: document.querySelector("#windMetric"),
  rainMetric: document.querySelector("#rainMetric"),
  tempMetric: document.querySelector("#tempMetric")
};

function scoreHour(hour) {
  let score = 48;
  const reasons = [];

  if (hour.rainProbability >= 60 || hour.precipitation > 0.7) {
    score -= 65;
    reasons.push("降雨风险高");
  } else if (hour.rainProbability >= 35 || hour.precipitation > 0.1) {
    score -= 32;
    reasons.push("可能有雨");
  }

  if (hour.humidity <= 55) {
    score += 24;
    reasons.push("湿度低");
  } else if (hour.humidity <= 70) {
    score += 12;
  } else if (hour.humidity <= 82) {
    score -= 12;
    reasons.push("湿度偏高");
  } else {
    score -= 28;
    reasons.push("湿度很高");
  }

  if (hour.wind >= 8 && hour.wind <= 25) {
    score += 18;
    reasons.push("风速合适");
  } else if (hour.wind > 35) {
    score -= 22;
    reasons.push("风太大");
  } else if (hour.wind < 4) {
    score -= 8;
  }

  if (hour.temperature >= 24) score += 16;
  else if (hour.temperature >= 16) score += 8;
  else if (hour.temperature < 10) score -= 14;

  if (hour.cloudCover <= 35) score += 12;
  else if (hour.cloudCover >= 80) score -= 10;

  if (hour.isDay) score += 16;
  else score -= 36;

  return {
    ...hour,
    score: Math.max(0, Math.min(100, Math.round(score))),
    reasons
  };
}

function getAdvice(score) {
  if (score >= 78) return { text: "很适合晾晒", className: "good" };
  if (score >= 58) return { text: "可以晾晒", className: "okay" };
  if (score >= 42) return { text: "只适合薄衣服", className: "okay" };
  return { text: "不建议晾晒", className: "bad" };
}

function formatHour(date) {
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatDateTime(date) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function findWindows(hours) {
  const profile = clothingProfiles[state.clothingType];
  const candidates = [];

  for (let start = 0; start <= hours.length - profile.neededHours; start += 1) {
    const block = hours.slice(start, start + profile.neededHours);
    if (block.some((hour) => !hour.isDay)) continue;

    const average = Math.round(block.reduce((sum, hour) => sum + hour.score, 0) / block.length);
    const lowest = Math.min(...block.map((hour) => hour.score));
    const rainMax = Math.max(...block.map((hour) => hour.rainProbability));
    const humidityAvg = Math.round(block.reduce((sum, hour) => sum + hour.humidity, 0) / block.length);

    candidates.push({
      start: block[0].date,
      end: new Date(block[block.length - 1].date.getTime() + 60 * 60 * 1000),
      average,
      lowest,
      rainMax,
      humidityAvg,
      hours: block
    });
  }

  return candidates
    .filter((item) => item.lowest >= 42)
    .sort((a, b) => b.average - a.average || a.rainMax - b.rainMax)
    .slice(0, 3);
}

function render() {
  if (!state.hours.length) return;

  const scoredHours = state.hours.map(scoreHour);
  const nowHour = scoredHours[0];
  const windows = findWindows(scoredHours);
  const best = windows[0];
  const advice = getAdvice(best ? best.average : nowHour.score);
  const ringScore = best ? best.average : nowHour.score;
  const profile = clothingProfiles[state.clothingType];

  els.scoreValue.textContent = ringScore;
  els.scoreRing.style.background = `conic-gradient(${ringScore >= 78 ? "#227a4f" : ringScore >= 42 ? "#a66800" : "#b83a2e"} ${ringScore * 3.6}deg, #ece7dc 0deg)`;
  els.mainAdvice.textContent = advice.text;
  els.mainAdvice.className = advice.className;
  els.locationLabel.textContent = state.place ? state.place.name : "当前位置";
  els.updatedAt.textContent = `更新 ${formatDateTime(new Date())}`;

  els.humidityMetric.textContent = `${nowHour.humidity}%`;
  els.windMetric.textContent = `${Math.round(nowHour.wind)} km/h`;
  els.rainMetric.textContent = `${nowHour.rainProbability}%`;
  els.tempMetric.textContent = `${Math.round(nowHour.temperature)}℃`;

  if (best) {
    els.summaryText.textContent = `${profile.label}建议 ${formatHour(best.start)}-${formatHour(best.end)} 晾晒，预计需要 ${profile.neededHours + profile.extraHours}-${profile.neededHours + profile.extraHours + 1} 小时。平均湿度约 ${best.humidityAvg}%，最高降雨概率 ${best.rainMax}%。`;
  } else {
    els.summaryText.textContent = "未来 24 小时没有稳定晾晒窗口。可以等湿度下降、降雨概率降低后再洗，或只短时间晾薄衣服。";
  }

  els.windowList.innerHTML = windows.length
    ? windows.map((item, index) => {
        const label = index === 0 ? "首选" : "备选";
        return `
          <div class="window-card">
            <strong>${label}：${formatHour(item.start)}-${formatHour(item.end)} · ${item.average}分</strong>
            <p>湿度约 ${item.humidityAvg}%，最高降雨概率 ${item.rainMax}%。${item.hours[0].reasons.slice(0, 2).join("，") || "整体条件稳定"}。</p>
          </div>
        `;
      }).join("")
    : `<p class="muted">今天不建议安排大件晾晒。若必须洗，优先选择速干薄衣物并放在通风处。</p>`;

  els.hourlyList.innerHTML = scoredHours.slice(0, 24).map((hour) => {
    const hourAdvice = getAdvice(hour.score);
    return `
      <div class="hour">
        <time>${formatHour(hour.date)}</time>
        <strong class="${hourAdvice.className}">${hour.score}</strong>
        <span>${hour.humidity}% · ${hour.rainProbability}%雨</span>
      </div>
    `;
  }).join("");
}

async function geocode(query) {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", query);
  url.searchParams.set("count", "1");
  url.searchParams.set("language", "zh");
  url.searchParams.set("format", "json");

  const response = await fetch(url);
  if (!response.ok) throw new Error("地区查询失败");
  const data = await response.json();
  if (!data.results?.length) throw new Error("没有找到这个地区");

  const result = data.results[0];
  return {
    name: [result.name, result.admin1, result.country].filter(Boolean).join("，"),
    latitude: result.latitude,
    longitude: result.longitude,
    timezone: result.timezone || "auto"
  };
}

async function fetchWeather(place) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", place.latitude);
  url.searchParams.set("longitude", place.longitude);
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", "2");
  url.searchParams.set("hourly", [
    "temperature_2m",
    "relative_humidity_2m",
    "precipitation_probability",
    "precipitation",
    "weather_code",
    "cloud_cover",
    "wind_speed_10m",
    "is_day"
  ].join(","));

  const response = await fetch(url);
  if (!response.ok) throw new Error("天气读取失败");
  const data = await response.json();
  const currentTime = Date.now();

  return data.hourly.time.map((time, index) => ({
    date: new Date(time),
    temperature: data.hourly.temperature_2m[index],
    humidity: data.hourly.relative_humidity_2m[index],
    rainProbability: data.hourly.precipitation_probability[index] ?? 0,
    precipitation: data.hourly.precipitation[index] ?? 0,
    weatherCode: data.hourly.weather_code[index],
    weatherText: weatherCodeText[data.hourly.weather_code[index]] || "天气变化",
    cloudCover: data.hourly.cloud_cover[index] ?? 50,
    wind: data.hourly.wind_speed_10m[index],
    isDay: Boolean(data.hourly.is_day[index])
  })).filter((hour) => hour.date.getTime() >= currentTime - 60 * 60 * 1000).slice(0, 36);
}

async function loadByPlace(place) {
  setLoading(`正在读取 ${place.name || "当前位置"} 的天气`);
  state.place = place;
  state.hours = await fetchWeather(place);
  render();
  localStorage.setItem("laundry-place", JSON.stringify(place));
}

function setLoading(message) {
  els.mainAdvice.textContent = message;
  els.summaryText.textContent = "正在分析湿度、风速、降雨概率和日照时间。";
  els.windowList.innerHTML = `<p class="muted">请稍等。</p>`;
}

function setError(error) {
  els.mainAdvice.textContent = "暂时无法生成建议";
  els.mainAdvice.className = "bad";
  els.summaryText.textContent = `${error.message}。可以输入城市名重试，或检查网络和定位权限。`;
  els.windowList.innerHTML = `<p class="muted">没有可用天气数据。</p>`;
}

function loadCurrentLocation() {
  if (!navigator.geolocation) {
    throw new Error("这个浏览器不支持定位");
  }

  setLoading("正在获取当前位置");
  navigator.geolocation.getCurrentPosition(
    async (position) => {
      try {
        await loadByPlace({
          name: "当前位置",
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          timezone: "auto"
        });
      } catch (error) {
        setError(error);
      }
    },
    async () => {
      const saved = localStorage.getItem("laundry-place");
      if (saved) {
        try {
          await loadByPlace(JSON.parse(saved));
          return;
        } catch (error) {
          setError(error);
          return;
        }
      }
      setError(new Error("定位被拒绝"));
    },
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 30 * 60 * 1000 }
  );
}

async function searchLocation() {
  const query = els.locationInput.value.trim();
  if (!query) {
    setError(new Error("请先输入城市或地区"));
    return;
  }

  try {
    const place = await geocode(query);
    await loadByPlace(place);
  } catch (error) {
    setError(error);
  }
}

els.searchButton.addEventListener("click", searchLocation);
els.locationInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") searchLocation();
});

els.refreshButton.addEventListener("click", async () => {
  try {
    if (state.place) await loadByPlace(state.place);
    else loadCurrentLocation();
  } catch (error) {
    setError(error);
  }
});

els.segments.forEach((button) => {
  button.addEventListener("click", () => {
    state.clothingType = button.dataset.type;
    els.segments.forEach((item) => item.classList.toggle("active", item === button));
    render();
  });
});

try {
  loadCurrentLocation();
} catch (error) {
  setError(error);
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
