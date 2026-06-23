#!/usr/bin/env bash
# Sample curl requests for Kalo Weather Proxy
# Usage: bash samples/curl.sh

PROXY="http://localhost:3000"
SECRET="CHANGE-ME"

echo "=== 1. Fallback request (no encrypted keys) ==="
curl -s "$PROXY/api/weather?lat=40.7128&lon=-74.0060&units=metric" \
  -H "Authorization: Bearer $SECRET" \
  -H "X-Client-Version: 1.2.0" | jq .

echo ""
echo "=== 2. With encrypted provider keys ==="
# First encrypt your keys (see scripts/encrypt_and_call.js for the encryption function)
ENC_WEATHER="<your-encrypted-weather-key>"
ENC_AQI="<your-encrypted-aqi-key>"

curl -s "$PROXY/api/weather?lat=48.8566&lon=2.3522&units=metric" \
  -H "Authorization: Bearer $SECRET" \
  -H "X-Client-Version: 1.2.0" \
  -H "X-Encrypted-Weather-Key: $ENC_WEATHER" \
  -H "X-Encrypted-Aqi-Key: $ENC_AQI" | jq .

echo ""
echo "=== 3. Imperial units ==="
curl -s "$PROXY/api/weather?lat=40.7128&lon=-74.0060&units=imperial" \
  -H "Authorization: Bearer $SECRET" \
  -H "X-Client-Version: 1.2.0" | jq .

echo ""
echo "=== 4. Config endpoint ==="
curl -s "$PROXY/api/config" | jq .

echo ""
echo "=== 5. Metrics endpoint ==="
curl -s "$PROXY/api/metrics" | jq .
