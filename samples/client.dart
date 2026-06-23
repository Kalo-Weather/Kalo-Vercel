import 'dart:convert';
import 'dart:math';
import 'package:http/http.dart' as http;
import 'package:cryptography/cryptography.dart';

/// Full Dart/Flutter client example for Kalo Weather Proxy.
/// 
/// Run this inside a Dart/Flutter project with:
///   dependencies:
///     http: ^1.2.0
///     cryptography: ^2.7.0

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

  Future<Map<String, dynamic>> getConfig() async {
    final uri = Uri.parse('$baseUrl/api/config');
    final res = await http.get(uri);
    return jsonDecode(res.body) as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> getMetrics() async {
    final uri = Uri.parse('$baseUrl/api/metrics');
    final res = await http.get(uri);
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
    final ivHex = _bytesToHex(nonce);
    final cipherHex = _bytesToHex(secretBox.cipherText);
    final tagHex = _bytesToHex(secretBox.mac.bytes);
    return '$ivHex:$cipherHex:$tagHex';
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

void main() async {
  final client = KaloWeatherClient();

  // 1. Fallback (no encrypted provider keys)
  print('--- Fallback (New York) ---');
  final fallback = await client.getWeather(lat: 40.7128, lon: -74.0060);
  print('Temp: ${fallback['current']['temp']}°C');
  print('Condition: ${fallback['current']['condition']}');
  print('Engine: ${fallback['meta']['engine']}');

  // 2. With encrypted keys (uncomment after setting decryptionSecret)
  // final client2 = KaloWeatherClient(
  //   decryptionSecret: 'CHANGE-ME',
  // );
  // final premium = await client2.getWeather(
  //   lat: 48.8566, lon: 2.3522,
  //   weatherProviderKey: 'your-openweathermap-key',
  //   aqiProviderKey: 'your-waqi-key',
  // );

  // 3. Imperial units
  print('\n--- Imperial ---');
  final imperial = await client.getWeather(
    lat: 40.7128, lon: -74.0060, units: 'imperial',
  );
  print('Temp: ${imperial['current']['temp']}°F');
  print('Wind: ${imperial['wind']['speed']} mph');

  // 4. Config
  print('\n--- Config ---');
  print(await client.getConfig());
}
