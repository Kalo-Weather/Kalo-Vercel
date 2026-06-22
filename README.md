# Kalo Weather Secure Proxy

This repository contains the Vercel serverless backend for the Kalo Weather secure proxy.

## Files

- `api/weather.js` - Secure serverless proxy for weather and AQI data.
- `api/config.js` - Dynamic configuration and feature flags endpoint.
- `vercel.json` - Vercel routing configuration.
- `.env.example` - Local environment variable example.

## Local Development

1. Copy `.env.example` to `.env`.
2. Install Vercel CLI if needed: `npm install -g vercel`.
3. Run local dev server: `vercel dev`.

## Test Endpoint

```bash
curl -i -H "Authorization: Bearer CHANGE-ME" \
     "http://localhost:3000/api/weather?lat=40.7128&lon=-74.0060"
```

If no encrypted weather key is provided, the proxy routes requests to Open-Meteo keyless fallback.

## Client sample (Node)

This repository includes a small Node script that demonstrates encrypting provider keys
and calling the local proxy with the encrypted headers.

Usage:

1. Ensure your local proxy is running (e.g. `vercel dev`).
2. (Optional) Copy `.env.example` to `.env` and customize secrets.
3. Run the sample:

```bash
node scripts/encrypt_and_call.js
```

The script sends two requests:
- a fallback request with no encrypted headers
- a request with `X-Encrypted-Weather-Key` and `X-Encrypted-Aqi-Key` headers

You can adjust `DECRYPTION_SECRET_KEY` and `KALO_CLIENT_APP_SECRET` via environment variables.

## Flutter / Dart encryption snippet

If your client is Flutter, you can use the `cryptography` package to encrypt provider keys
before sending them in the `X-Encrypted-*` headers. A sample helper is included at
`scripts/flutter_encrypt.dart`.

Example (Dart):

```dart
// Use package:cryptography (add to pubspec.yaml)
// final encrypted = await encryptKey('YOUR_OPENWEATHER_KEY', '<32-byte-hex-secret>');
// send as header: 'X-Encrypted-Weather-Key': encrypted
```

Note: I couldn't run the Dart snippet in this environment; run the example inside your
Flutter project or a local Dart environment.
