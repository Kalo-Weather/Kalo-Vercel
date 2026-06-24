const crypto = require('crypto');
const http = require('http');

const DECRYPTION_SECRET = process.env.DECRYPTION_SECRET_KEY || 'change-me-32-bytes-hex-secret-key';
const CLIENT_SECRET = process.env.KALO_CLIENT_APP_SECRET || 'change-me';
const HOST = process.env.KALO_PROXY_HOST || 'localhost';
const PORT = process.env.KALO_PROXY_PORT || 3000;
const PATH = `/api/weather?lat=40.7128&lon=-74.0060&units=metric`;

function encryptKey(plainText, hexKey) {
  const iv = crypto.randomBytes(12);
  const key = Buffer.from(hexKey, 'hex');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${encrypted.toString('hex')}:${authTag.toString('hex')}`;
}

function sendRequest(headers = {}, label='request') {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: HOST,
      port: PORT,
      path: PATH,
      method: 'GET',
      headers: Object.assign({
        Authorization: `Bearer ${CLIENT_SECRET}`,
        'X-Client-Version': '1.2.0'
      }, headers)
    };

    const req = http.request(options, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        console.log(`\n--- ${label} response (status ${res.statusCode}) ---`);
        try { console.log(JSON.parse(body)); } catch (e) { console.log(body); }
        resolve();
      });
    });

    req.on('error', err => reject(err));
    req.end();
  });
}

(async () => {
  console.log('1) Sending fallback request (no encrypted headers)...');
  await sendRequest({}, 'fallback');

  console.log('\n2) Sending encrypted-keys request...');
  const fakeWeatherKey = 'FAKE_OPENWEATHER_KEY_123';
  const fakeAqiKey = 'FAKE_WAQI_KEY_ABC';
  const encWeather = encryptKey(fakeWeatherKey, DECRYPTION_SECRET);
  const encAqi = encryptKey(fakeAqiKey, DECRYPTION_SECRET);

  await sendRequest({
    'X-Encrypted-Weather-Key': encWeather,
    'X-Encrypted-Aqi-Key': encAqi
  }, 'encrypted');

  console.log('\nDone.');
})().catch(err => { console.error('Error:', err); process.exit(1); });
