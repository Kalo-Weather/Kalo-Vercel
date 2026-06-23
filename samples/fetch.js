// Sample browser/Node.js fetch requests for Kalo Weather Proxy
// Run with: node samples/fetch.js (Node 18+)

const PROXY = process.env.KALO_PROXY_HOST || 'http://localhost:3000';
const SECRET = process.env.KALO_CLIENT_APP_SECRET || 'CHANGE-ME';

async function getWeather(lat, lon, units = 'metric', encryptedKeys = {}) {
  const params = new URLSearchParams({ lat, lon, units });
  const headers = {
    Authorization: `Bearer ${SECRET}`,
    'X-Client-Version': '1.2.0',
  };
  if (encryptedKeys.weather) headers['X-Encrypted-Weather-Key'] = encryptedKeys.weather;
  if (encryptedKeys.aqi) headers['X-Encrypted-Aqi-Key'] = encryptedKeys.aqi;

  const res = await fetch(`${PROXY}/api/weather?${params}`, { headers });
  return res.json();
}

async function getConfig() {
  const res = await fetch(`${PROXY}/api/config`);
  return res.json();
}

async function getMetrics() {
  const res = await fetch(`${PROXY}/api/metrics`);
  return res.json();
}

async function main() {
  // 1. Fallback (no encrypted keys)
  console.log('--- Fallback (New York) ---');
  const fallback = await getWeather('40.7128', '-74.0060');
  console.log(`Temp: ${fallback.current.temp}°C, ${fallback.current.condition}`);
  console.log(`UV: ${fallback.uv.index}, AQI: ${fallback.aqi.value}`);
  console.log(`Source: ${fallback.meta.engine}`);

  // 2. Encrypted keys (after encrypting provider keys)
  // const enc = getWeather('48.8566', '2.3522', 'metric', {
  //   weather: '<encrypted-openweather-key>',
  //   aqi: '<encrypted-waqi-key>',
  // });

  // 3. Imperial units
  console.log('\n--- Imperial (New York) ---');
  const imperial = await getWeather('40.7128', '-74.0060', 'imperial');
  console.log(`Temp: ${imperial.current.temp}°F, Wind: ${imperial.wind.speed} mph`);

  // 4. Config
  console.log('\n--- Config ---');
  const config = await getConfig();
  console.log(`Min app version: ${config.minimum_app_version}`);

  // 5. Metrics
  console.log('\n--- Metrics ---');
  const metrics = await getMetrics();
  console.log(`Total requests: ${metrics.total_requests}`);
}

main().catch(console.error);
