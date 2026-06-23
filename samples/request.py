"""Sample Python requests for Kalo Weather Proxy.
Usage: pip install requests; python samples/request.py
"""
import os
import requests

PROXY = os.getenv('KALO_PROXY_HOST', 'http://localhost:3000')
SECRET = os.getenv('KALO_CLIENT_APP_SECRET', 'CHANGE-ME')
HEADERS = {'Authorization': f'Bearer {SECRET}', 'X-Client-Version': '1.2.0'}


def get_weather(lat, lon, units='metric', enc_weather=None, enc_aqi=None):
    headers = dict(HEADERS)
    if enc_weather:
        headers['X-Encrypted-Weather-Key'] = enc_weather
    if enc_aqi:
        headers['X-Encrypted-Aqi-Key'] = enc_aqi
    params = {'lat': lat, 'lon': lon, 'units': units}
    resp = requests.get(f'{PROXY}/api/weather', params=params, headers=headers)
    return resp.json()


def get_config():
    return requests.get(f'{PROXY}/api/config').json()


def get_metrics():
    return requests.get(f'{PROXY}/api/metrics').json()


if __name__ == '__main__':
    # 1. Fallback request (no encrypted keys)
    print('--- Fallback (New York) ---')
    data = get_weather('40.7128', '-74.0060')
    print(f"Temp: {data['current']['temp']}°C, {data['current']['condition']}")
    print(f"UV: {data['uv']['index']}, AQI: {data['aqi']['value']}")
    print(f"Engine: {data['meta']['engine']}")

    # 2. Encrypted request (uncomment after encrypting your keys)
    # data = get_weather('48.8566', '2.3522',
    #     enc_weather='<your-encrypted-key>',
    #     enc_aqi='<your-encrypted-aqi-key>')

    # 3. Imperial units
    print('\n--- Imperial (New York) ---')
    data = get_weather('40.7128', '-74.0060', 'imperial')
    print(f"Temp: {data['current']['temp']}°F, Wind: {data['wind']['speed']} mph")

    # 4. Config
    print('\n--- Config ---')
    print(get_config())

    # 5. Metrics
    print('\n--- Metrics ---')
    print(get_metrics())
