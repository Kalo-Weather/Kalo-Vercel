import 'dart:convert';
import 'dart:typed_data';
import 'package:cryptography/cryptography.dart';

String _bytesToHex(List<int> bytes) => bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
List<int> _hexToBytes(String hex) {
  final result = <int>[];
  for (var i = 0; i < hex.length; i += 2) {
    final part = hex.substring(i, i + 2);
    result.add(int.parse(part, radix: 16));
  }
  return result;
}

/// Encrypt a small secret (provider API key) using AES-256-GCM.
/// Returns a string in the format: ivHex:cipherHex:tagHex
Future<String> encryptKey(String plainText, String hexKey) async {
  final keyBytes = _hexToBytes(hexKey);
  if (keyBytes.length != 32) {
    throw ArgumentError('DECRYPTION_SECRET_KEY must be 32 bytes (64 hex chars)');
  }

  final secretKey = SecretKey(keyBytes);
  final algorithm = AesGcm.with256bits();
  final nonce = algorithm.newNonce(); // 12 bytes

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

// Example usage (run within a Dart/Flutter environment):
//
// void main() async {
//   final decryptionSecret = 'CHANGE-ME';
//   final providerKey = 'YOUR_OPENWEATHER_KEY';
//   final encrypted = await encryptKey(providerKey, decryptionSecret);
//   print('X-Encrypted-Weather-Key: $encrypted');
// }
