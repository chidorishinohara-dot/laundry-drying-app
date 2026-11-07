const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../drying-model.js');
const P = require('../app.js');
const H = M.HOUR;
const start = Date.parse('2026-11-07T08:00:00+08:00');
const hour = (offset = 0, changes = {}) => M.assessHour({ date: new Date(start + offset * H),
  end: new Date(start + (offset + 1) * H), temperature: 24, humidity: 65, wind: 10,
  gust: 16, weatherCode: 0, precipitation: 0, rainProbability: 10, ...changes });

test('score is bounded, monotonic and continuous across the whole supported range', () => {
  let previous = M.potentialScore(0);
  for (let i = 1; i <= 20000; i++) {
    const score = M.potentialScore(i / 1000);
    assert.ok(score >= previous && score <= 100);
    assert.ok(score - previous < 0.1);
    previous = score;
  }
});
test('night does not impose an extra penalty on identical drying potential', () => {
  assert.equal(hour(0, { isDay: true }).score, hour(0, { isDay: false }).score);
});
test('score uses air temperature and RH, not outdoor ET0, direct sun or assumed rack wind', () => {
  assert.ok(hour(0, { humidity: 90 }).score < hour().score);
  assert.ok(hour(0, { temperature: 28 }).score > hour().score);
  assert.equal(hour(0, { humidity: 100 }).score, 0);
  assert.equal(hour(0, { et0: 2, radiation: 1000, wind: 25 }).score, hour().score);
  assert.ok(Math.abs(hour(0, { temperature: 20, humidity: 50 }).vpd - 1.169) < 0.002);
});
test('small RH change near the window threshold has no large score jump', () => {
  const a = hour(0, { temperature: 20, humidity: 74.3 });
  const b = hour(0, { temperature: 20, humidity: 74.4 });
  assert.ok(a.suitable && !b.suitable);
  assert.ok(Math.abs(a.score - b.score) <= 1);
});
test('rain probability changes the caution, not the score or a sheltered window', () => {
  const a = hour(0, { rainProbability: 39.9 });
  const b = hour(0, { rainProbability: 40 });
  assert.equal(a.score, b.score);
  assert.equal(a.suitable, true);
  assert.equal(b.suitable, true);
  assert.equal(a.rainWatch, false);
  assert.match(M.advice(b).text, /飘雨/);
  const wet = hour(1, { weatherCode: 61, precipitation: 2.5, rainProbability: 90 });
  assert.ok(wet.suitable && wet.rainWatch);
  const [period] = M.findPeriods([a, wet], 3, start);
  assert.ok(period.rainWatch);
  assert.equal(period.durationHours, 2);
});
test('storm, freezing precipitation, snow, excessive wind and freezing conditions veto hanging', () => {
  for (const changes of [{ weatherCode: 56 }, { weatherCode: 95 }, { weatherCode: 71 },
    { wind: 30 }, { gust: 40 }, { temperature: 0 }]) {
    const item = hour(0, { rainProbability: 80, ...changes });
    assert.equal(item.suitable, false);
    assert.ok(item.blockers.length);
    assert.equal(M.advice(item).className, 'bad');
  }
});
test('missing weather values are not silently treated as dry/calm conditions', () => {
  for (const key of ['temperature', 'humidity', 'wind', 'gust', 'weatherCode', 'precipitation', 'rainProbability']) {
    for (const value of [null, undefined, NaN]) {
      const item = hour(0, { [key]: value });
      assert.equal(item.suitable, false, key);
      assert.ok(item.missing.length, key);
    }
  }
  assert.equal(hour(0, { temperature: null }).blockers.length, 0);
});
test('invalid VPD and invalid met inputs cannot yield a favorable decision', () => {
  for (const value of [null, undefined, NaN, Infinity, -0.1, '0.2']) assert.equal(M.potentialScore(value), null);
  assert.equal(hour(0, { humidity: null }).score, null);
  for (const changes of [{ humidity: 101 }, { wind: -1 }, { rainProbability: -1 }, { weatherCode: 4 }]) {
    assert.equal(hour(0, changes).suitable, false);
  }
});
test('consecutive hours merge and weather interruptions split, first three chronologically', () => {
  const hours = [hour(7), hour(0), hour(1), hour(2, { weatherCode: 95 }), hour(3),
    hour(4, { humidity: 99 }), hour(5), hour(6, { gust: 50 }), hour(8)];
  const periods = M.findPeriods(hours, 3, start);
  assert.deepEqual(periods.map((p) => p.start.getTime()), [start, start + 3 * H, start + 5 * H]);
  assert.equal(periods[0].durationHours, 2);
});
test('missing timestamps break a window rather than inventing a dry hour', () => {
  assert.equal(M.findPeriods([hour(0), hour(2)], 3, start).length, 2);
});
test('current partial hour is prorated and elapsed hours excluded', () => {
  const periods = M.findPeriods([hour(-1), hour(0), hour(1)], 3, start + H / 2);
  assert.equal(periods.length, 1);
  assert.equal(periods[0].start.getTime(), start + H / 2);
  assert.equal(periods[0].durationHours, 1.5);
  assert.ok(Math.abs(periods[0].deficitHours - 1.5 * hour().vpd) < 1e-10);
});
test('all elapsed periods and invalid intervals are excluded', () => {
  assert.deepEqual(M.findPeriods([hour(0)], 3, start + H), []);
  assert.deepEqual(M.findPeriods([hour(0, { end: new Date(start + H * 2) })], 3, start), []);
});
test('local midnight splits days and windows, independent of device timezone', () => {
  const before = hour(15), after = hour(16);
  assert.equal(M.dayKey(before.date), '2026-11-07');
  assert.equal(M.dayKey(after.date), '2026-11-08');
  assert.equal(M.groupByDay([before, after]).size, 2);
  assert.equal(M.findPeriods([before, after], 3, start).length, 2);
});

function payload(count = 4) {
  const series = (fn) => Array.from({ length: count }, (_, i) => fn(i));
  return { latitude: 30.3, longitude: 120.2,
    hourly_units: { time: 'unixtime', temperature_2m: '°C', relative_humidity_2m: '%',
      wind_speed_10m: 'km/h', wind_gusts_10m: 'km/h', precipitation: 'mm', precipitation_probability: '%' },
    hourly: { time: series((i) => start / 1000 + i * 3600),
      temperature_2m: series((i) => 20 + i), relative_humidity_2m: series(() => 60),
      wind_speed_10m: series(() => 10), wind_gusts_10m: series(() => 15), weather_code: series(() => 0),
      precipitation_probability: series((i) => i * 10), precipitation: series((i) => i / 100) } };
}
test('provider pairs preceding-hour sums/probabilities with the correct interval', () => {
  const data = P.parseWeather(payload(), start + H / 2);
  assert.equal(data.hours[0].date.getTime(), start);
  assert.equal(data.hours[0].end.getTime(), start + H);
  assert.equal(data.hours[0].temperature, 20);
  assert.equal(data.hours[0].humidity, 60);
  assert.equal(data.hours[0].precipitation, 0.01);
  assert.equal(data.hours[0].rainProbability, 10);
});
test('provider preserves null and missing arrays instead of imputing zeros', () => {
  const data = payload();
  data.hourly.relative_humidity_2m[0] = null;
  delete data.hourly.precipitation_probability;
  const item = P.parseWeather(data, start).hours[0];
  assert.equal(item.humidity, null);
  assert.equal(item.rainProbability, null);
  assert.equal(M.assessHour(item).suitable, false);
});
test('provider rejects unexpected units and expired data', () => {
  const data = payload();
  data.hourly_units.wind_speed_10m = 'm/s';
  assert.throws(() => P.parseWeather(data, start), /单位/);
  assert.throws(() => P.parseWeather(payload(), start + 10 * H), /未来/);
});
test('provider does not stretch non-hourly or missing intervals', () => {
  const data = payload();
  data.hourly.time[1] += 3600;
  assert.equal(P.parseWeather(data, start).hours.length, 1);
});
test('eight requested days supply the final interval but display only seven local dates', () => {
  const data = P.parseWeather(payload(200), start);
  assert.equal(M.groupByDay(data.hours).size, 7);
  assert.equal(M.dayKey(data.hours.at(-1).date), '2026-11-13');
  assert.equal(data.hours.at(-1).end.toISOString(), '2026-11-13T16:00:00.000Z');
  const url = P.forecastUrl();
  assert.equal(url.searchParams.get('timeformat'), 'unixtime');
  assert.equal(url.searchParams.get('forecast_days'), '8');
  assert.doesNotMatch(url.searchParams.get('hourly'), /et0|radiation/);
});
