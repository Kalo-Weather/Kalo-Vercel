const crypto = require('crypto');
const { Redis } = require('@upstash/redis');
const cache = require('./cache');
const pubsub = require('./pubsub');

let redis = null;
try {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
} catch (e) {
  console.error('Weather Redis init error:', e.message);
}

async function recordMetric(event) {
  if (!redis) return;
  try {
    await redis.hincrby('metrics:counts', 'total_requests', 1);
    if (event.type) await redis.hincrby('metrics:counts', event.type, 1);
    const entry = {
      time: Date.now(),
      type: event.type,
      lat: event.lat || null,
      lon: event.lon || null,
      usedEncrypted: !!event.usedEncrypted,
      status: event.status || null,
    };
    await redis.lpush('metrics:requests', JSON.stringify(entry));
    await redis.ltrim('metrics:requests', 0, 49);
  } catch (e) {
    console.error('Metric write error', e);
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization, X-Encrypted-Weather-Key, X-Encrypted-Aqi-Key, X-Client-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const clientVersion = req.headers['x-client-version'] || '1.0.0';

    const authHeader = req.headers.authorization;
    const clientAppSecret = process.env.KALO_CLIENT_APP_SECRET;
    if (!authHeader || authHeader !== `Bearer ${clientAppSecret}`) {
      await recordMetric({ type: 'unauthorized', status: 401 });
      pubsub.publish('auth:unauthorized', { clientVersion });
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Verify client-side KALO_CLIENT_APP_SECRET.',
      });
    }

    const { lat, lon, units = 'metric' } = req.query;
    if (!lat || !lon) {
      await recordMetric({ type: 'bad_request', status: 400 });
      pubsub.publish('request:bad', { lat, lon, clientVersion });
      return res.status(400).json({ error: 'Missing lat/lon parameters' });
    }

    await cache.evictStaleCache();
    await cache.recordLocationAccess(lat, lon);
    const cached = await cache.getCachedResponse(lat, lon);
    if (cached) {
      cached.meta.cache = 'hit';
      await recordMetric({ type: 'success', lat, lon, usedEncrypted: false, status: 200 });
      pubsub.publish('cache:hit', { lat, lon, clientVersion });
      return res.status(200).json(cached);
    }

    const decryptionSecret = process.env.DECRYPTION_SECRET_KEY;
    let weatherApiKey = null;
    let waqiApiKey = null;
    const usedEncrypted = !!(req.headers['x-encrypted-weather-key'] || req.headers['x-encrypted-aqi-key']);

    if (decryptionSecret) {
      if (req.headers['x-encrypted-weather-key']) {
        weatherApiKey = decryptKey(req.headers['x-encrypted-weather-key'], decryptionSecret);
      }
      if (req.headers['x-encrypted-aqi-key']) {
        waqiApiKey = decryptKey(req.headers['x-encrypted-aqi-key'], decryptionSecret);
      }
    }

    if (!weatherApiKey) {
      await recordMetric({ type: 'fallback', lat, lon, usedEncrypted, status: 200 });
      pubsub.publish('weather:fallback', { lat, lon, units, clientVersion });
      return await handleMultiSourceFallback(lat, lon, units, res);
    }

    const weatherUrl = `https://api.openweathermap.org/data/2.5/onecall?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&exclude=minutely,alerts&units=${encodeURIComponent(units)}&appid=${encodeURIComponent(weatherApiKey)}`;
    const aqiUrl = `https://api.waqi.info/feed/geo:${encodeURIComponent(lat)};${encodeURIComponent(lon)}/?token=${encodeURIComponent(waqiApiKey || 'demo')}`;

    const [weatherResponse, aqiResponse] = await Promise.all([
      fetch(weatherUrl).then((r) => r.json()),
      fetch(aqiUrl).then((r) => r.json()),
    ]);

    if (weatherResponse.cod && weatherResponse.cod !== 200) {
      await recordMetric({ type: 'provider_error', lat, lon, usedEncrypted, status: 400 });
      pubsub.publish('provider:error', { lat, lon, message: weatherResponse.message });
      return res.status(400).json({
        error: 'Provider rejected key',
        message: weatherResponse.message || 'Invalid or expired API Key.',
      });
    }

    const normalizedPayload = {
      meta: {
        server_version: '1.2.0',
        client_compatibility_min: '1.0.0',
        engine: 'Kalo Decrypted Proxy Platform',
        client_version: clientVersion,
        cache: 'miss',
      },
      coordinates: { lat: parseFloat(lat), lon: parseFloat(lon) },
      current: parseCurrentWeather(weatherResponse),
      uv: parseUV(weatherResponse),
      aqi: parseAQI(aqiResponse),
      wind: parseWind(weatherResponse),
      humidity: parseHumidity(weatherResponse),
      forecast: parseForecasts(weatherResponse),
    };

    await recordMetric({ type: 'success', lat, lon, usedEncrypted, status: 200 });
    await cache.setCachedResponse(lat, lon, normalizedPayload);
    pubsub.publish('weather:fetched', { lat, lon, units, clientVersion, source: 'premium' });
    return res.status(200).json(normalizedPayload);
  } catch (error) {
    console.error('Proxy Processing Error:', error);
    await recordMetric({ type: 'error', status: 500 });
    pubsub.publish('system:error', { message: error.message });
    return res.status(500).json({ error: 'Processing Error', details: error.message });
  }
};

function decryptKey(encryptedString, hexKey) {
  try {
    const parts = encryptedString.split(':');
    if (parts.length !== 3) return null;

    const iv = Buffer.from(parts[0], 'hex');
    const encryptedText = Buffer.from(parts[1], 'hex');
    const authTag = Buffer.from(parts[2], 'hex');
    const key = Buffer.from(hexKey, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedText, 'binary', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (e) {
    console.error('Decryption failed:', e.message);
    return null;
  }
}

const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';
const SEVEN_TIMER_URL = 'http://www.7timer.info/bin/api.pl';
const AQ_API_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';

async function fetchOpenMeteo(lat, lon, units) {
  const tempUnit = units === 'imperial' ? 'fahrenheit' : 'celsius';
  const windUnit = units === 'imperial' ? 'mph' : 'kmh';

  const url = `${OPEN_METEO_URL}?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,uv_index&hourly=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min&temperature_unit=${encodeURIComponent(tempUnit)}&wind_speed_unit=${encodeURIComponent(windUnit)}&timezone=auto`;
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) return null;

  const c = data.current || {};
  return {
    source: 'open-meteo',
    current: {
      temp: c.temperature_2m,
      feels_like: c.apparent_temperature,
      humidity: c.relative_humidity_2m,
      weather_code: c.weather_code,
      wind_speed: c.wind_speed_10m,
      wind_direction: c.wind_direction_10m,
      wind_gust: c.wind_gusts_10m,
      uv_index: c.uv_index,
    },
    forecast: {
      hourly: (data.hourly || {}).time
        ? data.hourly.time.slice(0, 24).map((t, i) => ({
            time: Math.floor(new Date(t).getTime() / 1000),
            temp: data.hourly.temperature_2m[i],
            weather_code: data.hourly.weather_code[i],
          }))
        : [],
      daily: (data.daily || {}).time
        ? data.daily.time.slice(0, 7).map((t, i) => ({
            time: Math.floor(new Date(t).getTime() / 1000),
            min: data.daily.temperature_2m_min[i],
            max: data.daily.temperature_2m_max[i],
            weather_code: data.daily.weather_code[i],
          }))
        : [],
    },
  };
}

function directionToDeg(dir) {
  const map = { N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5, S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5 };
  return map[dir] ?? null;
}

async function fetch7Timer(lat, lon) {
  const url = `${SEVEN_TIMER_URL}?lon=${encodeURIComponent(lon)}&lat=${encodeURIComponent(lat)}&product=civil&output=json`;
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok || !data.dataseries || data.dataseries.length === 0) return null;

  const first = data.dataseries[0];
  return {
    source: '7timer',
    current: {
      temp: first.temp2m,
      feels_like: first.temp2m,
      humidity: parseFloat(first.rh2m),
      weather_code: null,
      wind_speed: first.wind10m?.speed || null,
      wind_direction: first.wind10m ? directionToDeg(first.wind10m.direction) : null,
      wind_gust: null,
      uv_index: null,
    },
    forecast: null,
  };
}

async function fetchAirQuality(lat, lon) {
  const url = `${AQ_API_URL}?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&current=european_aqi`;
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok || !data.current) return null;

  const value = data.current.european_aqi || 0;
  let level = 'Good';
  let msg = 'Air quality is satisfactory.';
  if (value > 50 && value <= 100) { level = 'Moderate'; msg = 'Air quality is acceptable.'; } else if (value > 100 && value <= 150) { level = 'Unhealthy (Sensitive)'; msg = 'Sensitive groups should limit outdoor activity.'; } else if (value > 150) { level = 'Unhealthy'; msg = 'Limit outdoor exposure.'; }

  return { value, level, msg };
}

function averageSources(sources) {
  if (!sources.length) return null;

  const nums = (fn) => sources.map((s) => fn(s)).filter((v) => v != null);
  const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null);

  const temps = nums((s) => s.current.temp);
  const feels = nums((s) => s.current.feels_like);
  const humids = nums((s) => s.current.humidity);
  const speeds = nums((s) => s.current.wind_speed);
  const dirs = nums((s) => s.current.wind_direction);
  const gusts = nums((s) => s.current.wind_gust);
  const uvs = nums((s) => s.current.uv_index);

  const avgWindDir = (arr) => {
    if (!arr.length) return 0;
    const rad = arr.map((d) => (d * Math.PI) / 180);
    const sinSum = rad.reduce((a, r) => a + Math.sin(r), 0);
    const cosSum = rad.reduce((a, r) => a + Math.cos(r), 0);
    return (((Math.atan2(sinSum, cosSum) * 180) / Math.PI) % 360 + 360) % 360;
  };

  const conditions = sources.filter((s) => s.current.weather_code != null).map((s) => mapWMOToConditionString(s.current.weather_code));
  const sourceConditions = sources.filter((s) => s.current.weather_code == null && s.current.condition).map((s) => s.current.condition);
  const allConditions = [...conditions, ...sourceConditions];
  const counts = {};
  allConditions.forEach((c) => (counts[c] = (counts[c] || 0) + 1));
  const topCondition = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Cloudy';

  const illustrationMap = {
    'Clear Sky': 'sun', 'Mainly Clear': 'cloud-sun', Cloudy: 'cloudy',
    Drizzle: 'rain', Rainy: 'rain', 'Snow Fall': 'snow', Thunderstorm: 'thunderstorm',
  };

  const avgTemp = avg(temps) || 0;
  const avgHumid = avg(humids) || 0;

  return {
    current: {
      temp: avgTemp,
      feels_like: avg(feels) || avgTemp,
      condition: topCondition,
      illustration_code: illustrationMap[topCondition] || 'sun',
    },
    uv_index: uvs.length ? uvs.reduce((a, b) => a + b, 0) / uvs.length : 0,
    wind: {
      speed: avg(speeds) || 0,
      deg: Math.round(avgWindDir(dirs)),
      gust: avg(gusts) || avg(speeds) || 0,
    },
    humidity: { value: avgHumid },
  };
}

async function handleMultiSourceFallback(lat, lon, units, res) {
  const [omResult, timerResult, aqiResult] = await Promise.allSettled([
    fetchOpenMeteo(lat, lon, units),
    fetch7Timer(lat, lon),
    fetchAirQuality(lat, lon),
  ]);

  const sources = [];
  if (omResult.status === 'fulfilled' && omResult.value) sources.push(omResult.value);
  if (timerResult.status === 'fulfilled' && timerResult.value) sources.push(timerResult.value);

  const aqi = aqiResult.status === 'fulfilled' && aqiResult.value
    ? aqiResult.value
    : { value: 35, level: 'Good', msg: 'Satisfactory air index' };

  const avg = averageSources(sources);
  const omForecast = omResult.status === 'fulfilled' && omResult.value ? omResult.value.forecast : null;

  const fallbackPayload = {
    meta: {
      server_version: '1.2.0',
      client_compatibility_min: '1.0.0',
      engine: `Multi-Source Averaged Engine (${sources.length} sources)`,
      cache: 'miss',
    },
    coordinates: { lat: parseFloat(lat), lon: parseFloat(lon) },
    current: {
      temp: avg.current.temp,
      feels_like: avg.current.feels_like,
      condition: avg.current.condition,
      illustration_code: avg.current.illustration_code,
      timestamp: Math.floor(Date.now() / 1000),
    },
    uv: {
      index: Math.round(avg.uv_index),
      level: avg.uv_index <= 2 ? 'Low' : avg.uv_index <= 5 ? 'Moderate' : 'High',
      msg: avg.uv_index <= 2 ? 'No protection required.' : 'Protection suggested.',
    },
    aqi,
    wind: avg.wind,
    humidity: {
      value: avg.humidity.value,
      dew_point: Math.round(avg.current.temp - (100 - avg.humidity.value) / 5),
      msg: avg.humidity.value > 60 ? 'Sticky' : 'Comfortable',
    },
    forecast: {
      hourly: (omForecast?.hourly || []).slice(0, 24).map((h) => ({
        time: h.time,
        temp: Math.round(h.temp),
        condition: mapWMOToConditionString(h.weather_code),
      })),
      daily: (omForecast?.daily || []).slice(0, 7).map((d) => ({
        time: d.time,
        min: Math.round(d.min),
        max: Math.round(d.max),
        condition: mapWMOToConditionString(d.weather_code),
      })),
    },
  };

  await cache.setCachedResponse(lat, lon, fallbackPayload);
  pubsub.publish('weather:fetched', { lat, lon, units, source: 'fallback' });
  return res.status(200).json(fallbackPayload);
}

function parseCurrentWeather(data) {
  return {
    temp: Math.round(data.current?.temp ?? 0),
    feels_like: Math.round(data.current?.feels_like ?? 0),
    condition: data.current?.weather?.[0]?.main ?? 'Unknown',
    condition_desc: data.current?.weather?.[0]?.description ?? '',
    illustration_code: mapConditionToIllustration(data.current?.weather?.[0]?.id, data.current?.weather?.[0]?.icon),
    timestamp: data.current?.dt ?? Math.floor(Date.now() / 1000),
  };
}

function parseUV(data) {
  const index = Math.round(data.current?.uvi ?? 0);
  let level = 'Low';
  let msg = 'Safe to spend time outdoors.';

  if (index > 2 && index <= 5) { level = 'Moderate'; msg = 'Apply sunscreen. Seek shade.'; } else if (index > 5 && index <= 7) { level = 'High'; msg = 'Wear a hat, sunglasses, and SPF.'; } else if (index > 7) { level = 'Very High'; msg = 'Minimize direct mid-day sun exposure.'; }

  return { index, level, msg };
}

function parseAQI(data) {
  const value = data.data?.aqi ?? 0;
  let level = 'Good';
  if (value > 50 && value <= 100) level = 'Moderate';
  else if (value > 100 && value <= 150) level = 'Unhealthy (Sensitive)';
  else if (value > 150) level = 'Unhealthy';

  return {
    value,
    level,
    msg: data.data?.dominentpol ? `Dominant pollutant: ${data.data.dominentpol.toUpperCase()}` : 'Air quality is satisfactory.',
  };
}

function parseWind(data) {
  return {
    speed: Math.round(data.current?.wind_speed ?? 0),
    deg: data.current?.wind_deg ?? 0,
    gust: Math.round(data.current?.wind_gust ?? 0),
  };
}

function parseHumidity(data) {
  const value = data.current?.humidity ?? 0;
  return {
    value,
    dew_point: Math.round(data.current?.dew_point ?? 0),
    msg: value > 60 ? 'Sticky / Humid' : 'Comfortable',
  };
}

function parseForecasts(data) {
  return {
    hourly: (data.hourly?.hourly ?? data.hourly ?? []).slice(0, 24).map((h) => ({
      time: h.dt,
      temp: Math.round(h.temp),
      icon: h.weather?.[0]?.icon,
    })),
    daily: (data.daily ?? []).slice(0, 7).map((d) => ({
      time: d.dt,
      min: Math.round(d.temp?.min),
      max: Math.round(d.temp?.max),
      condition: d.weather?.[0]?.main,
      icon: d.weather?.[0]?.icon,
    })),
  };
}

function mapConditionToIllustration(code, icon) {
  if (!code) return 'sun';
  const isNight = icon ? icon.endsWith('n') : false;
  if (code >= 200 && code < 300) return 'thunderstorm';
  if (code >= 300 && code < 600) return isNight ? 'rain-night' : 'rain';
  if (code >= 600 && code < 700) return 'snow';
  if (code === 800) return isNight ? 'clear-night' : 'sun';
  return isNight ? 'cloudy-night' : 'cloud-sun';
}

function mapWMOToIllustration(code) {
  if (code === 0) return 'sun';
  if ([1, 2, 3].includes(code)) return 'cloud-sun';
  if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) return 'rain';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'snow';
  if ([95, 96, 99].includes(code)) return 'thunderstorm';
  return 'cloudy';
}

function mapWMOToConditionString(code) {
  if (code === 0) return 'Clear Sky';
  if ([1, 2, 3].includes(code)) return 'Mainly Clear';
  if ([51, 53, 55].includes(code)) return 'Drizzle';
  if ([61, 63, 65].includes(code)) return 'Rainy';
  if ([71, 73, 75].includes(code)) return 'Snow Fall';
  if ([95, 96, 99].includes(code)) return 'Thunderstorm';
  return 'Cloudy';
}
