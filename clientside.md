# Kalo Weather Proxy — Client-Side Reference

## Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/weather?lat=&lon=&units=` | Bearer token | Weather + AQI data |
| GET | `/api/config` | None | App version + feature flags |
| GET | `/api/metrics` | None | Usage statistics |

## Authentication

All `/api/weather` requests require an `Authorization: Bearer <secret>` header.
The secret is defined by `KALO_CLIENT_APP_SECRET` on the server.

## Headers

| Header | Required | Description |
|--------|----------|-------------|
| `Authorization` | Yes | `Bearer {KALO_CLIENT_APP_SECRET}` |
| `X-Client-Version` | Yes | e.g. `1.2.0` |
| `X-Encrypted-Weather-Key` | No | AES-256-GCM encrypted OpenWeatherMap key |
| `X-Encrypted-Aqi-Key` | No | AES-256-GCM encrypted WAQI key |

## Query Parameters

| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `lat` | Yes | — | Latitude |
| `lon` | Yes | — | Longitude |
| `units` | No | `metric` | `metric` or `imperial` |

## Request Flow

```
                   ┌──────────────────────────────┐
                   │  Encrypted keys provided?     │
                   └──────────┬───────────────────┘
                              │
                ┌─────────────┴─────────────┐
                ▼                           ▼
        ┌─────────────────┐       ┌───────────────────┐
        │ OpenWeatherMap   │       │ Multi-source avg  │
        │ + WAQI (premium) │       │ Open-Meteo +      │
        │                 │       │ 7Timer! + AQ API   │
        └─────────────────┘       └───────────────────┘
```

## cURL Examples

```bash
# 1. Fallback (multi-source averaged)
curl -s "http://localhost:3000/api/weather?lat=40.7128&lon=-74.0060&units=metric" \
  -H "Authorization: Bearer CHANGE-ME" \
  -H "X-Client-Version: 1.2.0" | jq .

# 2. With encrypted provider keys
curl -s "http://localhost:3000/api/weather?lat=48.8566&lon=2.3522&units=metric" \
  -H "Authorization: Bearer CHANGE-ME" \
  -H "X-Client-Version: 1.2.0" \
  -H "X-Encrypted-Weather-Key: <iv>:<cipher>:<tag>" \
  -H "X-Encrypted-Aqi-Key: <iv>:<cipher>:<tag>" | jq .

# 3. Imperial units
curl -s "http://localhost:3000/api/weather?lat=40.7128&lon=-74.0060&units=imperial" \
  -H "Authorization: Bearer CHANGE-ME" \
  -H "X-Client-Version: 1.2.0" | jq .

# 4. Config
curl -s "http://localhost:3000/api/config" | jq .

# 5. Metrics
curl -s "http://localhost:3000/api/metrics" | jq .
```

## JavaScript (Node 18+ / Browser)

```js
const PROXY = 'http://localhost:3000';
const SECRET = 'CHANGE-ME';

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

// Usage
const data = await getWeather('40.7128', '-74.0060');
console.log(data.current.temp, data.current.condition);
```

## Python

```py
import requests

PROXY = 'http://localhost:3000'
SECRET = 'CHANGE-ME'

def get_weather(lat, lon, units='metric', enc_weather=None, enc_aqi=None):
    headers = {'Authorization': f'Bearer {SECRET}', 'X-Client-Version': '1.2.0'}
    if enc_weather: headers['X-Encrypted-Weather-Key'] = enc_weather
    if enc_aqi: headers['X-Encrypted-Aqi-Key'] = enc_aqi
    params = {'lat': lat, 'lon': lon, 'units': units}
    return requests.get(f'{PROXY}/api/weather', params=params, headers=headers).json()

# Usage
data = get_weather('40.7128', '-74.0060')
print(data['current']['temp'], data['current']['condition'])
```

## Dart / Flutter

```dart
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:cryptography/cryptography.dart';

class KaloWeatherClient {
  final String baseUrl;
  final String clientSecret;
  final String? decryptionSecret;

  KaloWeatherClient({
    this.baseUrl = 'http://localhost:3000',
    this.clientSecret = 'CHANGE-ME',
    this.decryptionSecret,
  });

  Future<Map<String, dynamic>> getWeather({
    required double lat,
    required double lon,
    String units = 'metric',
    String? weatherProviderKey,
    String? aqiProviderKey,
  }) async {
    final headers = <String, String>{
      'Authorization': 'Bearer $clientSecret',
      'X-Client-Version': '1.2.0',
    };

    if (weatherProviderKey != null && decryptionSecret != null) {
      headers['X-Encrypted-Weather-Key'] =
          await _encryptKey(weatherProviderKey, decryptionSecret!);
    }
    if (aqiProviderKey != null && decryptionSecret != null) {
      headers['X-Encrypted-Aqi-Key'] =
          await _encryptKey(aqiProviderKey, decryptionSecret!);
    }

    final params = {
      'lat': lat.toString(),
      'lon': lon.toString(),
      'units': units,
    };
    final uri = Uri.parse('$baseUrl/api/weather').replace(queryParameters: params);
    final res = await http.get(uri, headers: headers);
    return jsonDecode(res.body) as Map<String, dynamic>;
  }

  Future<String> _encryptKey(String plainText, String hexKey) async {
    final keyBytes = _hexToBytes(hexKey);
    final secretKey = SecretKey(keyBytes);
    final algorithm = AesGcm.with256bits();
    final nonce = algorithm.newNonce();
    final secretBox = await algorithm.encrypt(
      utf8.encode(plainText),
      secretKey: secretKey,
      nonce: nonce,
    );
    return '${_bytesToHex(nonce)}:${_bytesToHex(secretBox.cipherText)}:${_bytesToHex(secretBox.mac.bytes)}';
  }

  String _bytesToHex(List<int> bytes) =>
      bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();

  List<int> _hexToBytes(String hex) {
    final result = <int>[];
    for (var i = 0; i < hex.length; i += 2) {
      result.add(int.parse(hex.substring(i, i + 2), radix: 16));
    }
    return result;
  }
}

// Usage
final client = KaloWeatherClient();
final data = await client.getWeather(lat: 40.7128, lon: -74.0060);
print(data['current']['temp']);
```

## Response Format

```json
{
  "meta": {
    "server_version": "1.2.0",
    "client_compatibility_min": "1.0.0",
    "engine": "Multi-Source Averaged Engine (2 sources)"
  },
  "coordinates": { "lat": 40.71, "lon": -74.01 },
  "current": {
    "temp": 21,
    "feels_like": 22,
    "condition": "Mainly Clear",
    "illustration_code": "cloud-sun",
    "timestamp": 1782245118
  },
  "uv": { "index": 1, "level": "Low", "msg": "No protection required." },
  "aqi": { "value": 32, "level": "Good", "msg": "Air quality is satisfactory." },
  "wind": { "speed": 7, "deg": 351, "gust": 21 },
  "humidity": { "value": 85, "dew_point": 18, "msg": "Sticky" },
  "forecast": {
    "hourly": [
      { "time": 1782187200, "temp": 22, "condition": "Drizzle" }
    ],
    "daily": [
      { "time": 1782172800, "min": 19, "max": 22, "condition": "Rainy" }
    ]
  }
}
```

## Encryption (AES-256-GCM)

Provider keys are encrypted client-side before sending. Format: `ivHex:cipherHex:tagHex`.

- Algorithm: `aes-256-gcm`
- Nonce/IV: 12 random bytes
- Key: 32 bytes (64 hex chars) — must match server's `DECRYPTION_SECRET_KEY`

### Node.js encryption helper

```js
const crypto = require('crypto');

function encryptKey(plainText, hexKey) {
  const iv = crypto.randomBytes(12);
  const key = Buffer.from(hexKey, 'hex');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${encrypted.toString('hex')}:${authTag.toString('hex')}`;
}
```

### Dart encryption helper

See `_encryptKey` method in the Dart client class above, or `scripts/flutter_encrypt.dart`.
