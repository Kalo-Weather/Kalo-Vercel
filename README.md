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

## Client-Side Reference

See [`clientside.md`](./clientside.md) for a complete client-side reference (endpoints, headers, response format, and examples in cURL, JavaScript, Python, and Dart).

### Quick test (curl)

```bash
curl -s -H "Authorization: Bearer $KALO_CLIENT_APP_SECRET" \
  -H "X-Client-Version: 1.2.0" \
  "http://localhost:3000/api/weather?lat=40.7128&lon=-74.0060&units=metric" | jq .
```

### Encryption test (Node)

```bash
node scripts/encrypt_and_call.js
```

Sends two requests: one fallback (no encrypted keys) and one with encrypted `X-Encrypted-Weather-Key` / `X-Encrypted-Aqi-Key` headers.

### Available endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/weather?lat=&lon=&units=` | Weather + AQI proxy (multi-source averaged fallback) |
| `GET /api/config` | App version + feature flags |
| `GET /api/metrics` | Usage stats
