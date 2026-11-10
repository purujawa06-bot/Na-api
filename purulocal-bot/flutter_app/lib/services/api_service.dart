import 'dart:convert';
import 'package:http/http.dart' as http;
import '../models/bot_config.dart';

class ApiService {
  // Backend Go berjalan lokal di device (bukan backend na-api)
  final String baseUrl;
  ApiService({this.baseUrl = 'http://127.0.0.1:8787'});

  Future<Map<String, dynamic>> status() async {
    final r = await http.get(Uri.parse('$baseUrl/api/status'));
    return jsonDecode(r.body);
  }

  Future<BotConfig> getConfig() async {
    final r = await http.get(Uri.parse('$baseUrl/api/config'));
    final j = jsonDecode(r.body);
    return BotConfig.fromJson(j['config'] ?? {});
  }

  Future<void> saveConfig(BotConfig cfg) async {
    final r = await http.post(Uri.parse('$baseUrl/api/config'),
        headers: {'Content-Type': 'application/json'}, body: jsonEncode(cfg.toJson()));
    final j = jsonDecode(r.body);
    if (j['ok'] != true) throw Exception(j['error'] ?? 'Gagal simpan');
  }

  Future<String?> connectQR() async {
    final r = await http.post(Uri.parse('$baseUrl/api/connect/qr'));
    final j = jsonDecode(r.body);
    if (j['ok'] == true && j['qr'] != null) return j['qr'] as String;
    throw Exception(j['error'] ?? 'Gagal meminta QR');
  }

  Future<String> pair(String phone) async {
    final r = await http.post(Uri.parse('$baseUrl/api/connect/pair'),
        headers: {'Content-Type': 'application/json'}, body: jsonEncode({'phone': phone}));
    final j = jsonDecode(r.body);
    if (j['ok'] == true) return (j['pairing_code'] ?? '').toString();
    throw Exception(j['error'] ?? 'Gagal meminta pairing code');
  }

  Future<void> disconnect() async => http.post(Uri.parse('$baseUrl/api/disconnect'));
  Future<void> logout() async => http.post(Uri.parse('$baseUrl/api/logout'));
}