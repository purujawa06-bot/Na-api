import 'package:flutter/material.dart';
import 'package:qr_flutter/qr_flutter.dart';
import '../models/bot_config.dart';
import '../services/api_service.dart';
import '../services/update_service.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});
  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final api = ApiService();
  final botName = TextEditingController();
  final ownerName = TextEditingController();
  final ownerNumber = TextEditingController();
  final botNumber = TextEditingController();
  bool blockSelf = true;
  String status = 'Memuat...';
  String? qrData;
  String? pairCode;
  String? msg;
  bool loading = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final s = await api.status();
      final c = BotConfig.fromJson((s['config'] ?? {}) as Map<String, dynamic>);
      botName.text = c.botName;
      ownerName.text = c.ownerName;
      ownerNumber.text = c.ownerNumber;
      botNumber.text = c.botNumber;
      blockSelf = c.blockSelfChat;
      final st = s['status'] ?? {};
      setState(() => status = 'Connected: ${st['connected'] == true} · Logged in: ${st['logged_in'] == true}\n${st['jid'] ?? ''}');
    } catch (e) {
      setState(() => status = 'Backend lokal belum aktif. Jalankan service puruLocal di perangkat.\n$e');
    }
  }

  BotConfig _cfg() => BotConfig(
        botName: botName.text.trim().isEmpty ? 'puruLocal Bot' : botName.text.trim(),
        ownerName: ownerName.text.trim(),
        ownerNumber: ownerNumber.text.trim(),
        botNumber: botNumber.text.trim().isEmpty ? ownerNumber.text.trim() : botNumber.text.trim(),
        blockSelfChat: blockSelf,
      );

  Future<void> _save() async {
    setState(() { loading = true; msg = null; });
    try {
      await api.saveConfig(_cfg());
      setState(() => msg = 'Konfigurasi tersimpan.');
    } catch (e) {
      setState(() => msg = 'Gagal: $e');
    } finally { setState(() => loading = false); _load(); }
  }

  Future<void> _connectQR() async {
    await _save();
    setState(() { loading = true; msg = 'Meminta QR...'; pairCode = null; });
    try {
      final code = await api.connectQR();
      setState(() { qrData = code; msg = 'QR siap, scan dari WhatsApp > Perangkat tertaut.'; });
    } catch (e) {
      setState(() => msg = 'QR gagal: $e');
    } finally { setState(() => loading = false); }
  }

  Future<void> _connectPair() async {
    await _save();
    setState(() { loading = true; msg = 'Meminta pairing code...'; qrData = null; });
    try {
      final phone = botNumber.text.trim().isEmpty ? ownerNumber.text.trim() : botNumber.text.trim();
      final code = await api.pair(phone);
      setState(() { pairCode = code; msg = 'Masukkan kode di WhatsApp > Perangkat tertaut > Tautkan dengan nomor telepon.'; });
    } catch (e) {
      setState(() => msg = 'Pairing gagal: $e');
    } finally { setState(() => loading = false); }
  }

  Future<void> _checkUpdate() async {
    final manifestUrl = _cfg().updateManifestUrl ?? '';
    if (manifestUrl.isEmpty) {
      setState(() => msg = 'URL manifest auto-update belum diatur.');
      return;
    }
    setState(() { loading = true; msg = 'Mengecek update...'; });
    try {
      final svc = UpdateService(manifestUrl);
      final info = await svc.check();
      if (info == null) { setState(() => msg = 'Sudah versi terbaru.'); return; }
      if (!mounted) return;
      final ok = await showDialog<bool>(context: context, builder: (c) => AlertDialog(
        title: Text('Update ${info.versionName} (build ${info.buildNumber})'),
        content: Text(info.changelog.isEmpty ? 'Versi baru tersedia.' : info.changelog),
        actions: [
          if (!info.force) TextButton(onPressed: ()=>Navigator.pop(c,false), child: const Text('Nanti')),
          FilledButton(onPressed: ()=>Navigator.pop(c,true), child: const Text('Update')),
        ],
      ));
      if (ok != true) return;
      setState(() => msg = 'Mengunduh APK...');
      final file = await svc.download(info);
      setState(() => msg = 'Memasang update...');
      await svc.install(file);
    } catch (e) {
      setState(() => msg = 'Update gagal: $e');
    } finally { setState(() => loading = false); }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('puruLocal Bot'), actions: [
        IconButton(onPressed: _load, icon: const Icon(Icons.refresh)),
        IconButton(onPressed: _checkUpdate, icon: const Icon(Icons.system_update)),
      ]),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Card(child: Padding(padding: const EdgeInsets.all(12), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('Status (sesi lokal di perangkat)', style: TextStyle(fontWeight: FontWeight.bold)),
          const SizedBox(height: 6), Text(status, style: const TextStyle(fontSize: 12)),
        ]))),
        Card(child: Padding(padding: const EdgeInsets.all(12), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('Konfigurasi Dasar', style: TextStyle(fontWeight: FontWeight.bold)),
          TextField(controller: botName, decoration: const InputDecoration(labelText: 'Nama Bot (bisa di set)')),
          TextField(controller: ownerName, decoration: const InputDecoration(labelText: 'Nama Owner')),
          TextField(controller: ownerNumber, decoration: const InputDecoration(labelText: 'Nomor Owner (tanpa +)'), keyboardType: TextInputType.phone),
          TextField(controller: botNumber, decoration: const InputDecoration(labelText: 'Nomor Bot (boleh sama)'), keyboardType: TextInputType.phone),
          SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('Bot tidak bisa chat diri sendiri'), value: blockSelf, onChanged: (v)=>setState(()=>blockSelf=v)),
          SizedBox(width: double.infinity, child: FilledButton(onPressed: loading?null:_save, child: const Text('Simpan Konfigurasi'))),
        ]))),
        Card(child: Padding(padding: const EdgeInsets.all(12), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('Koneksi WhatsApp', style: TextStyle(fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          Row(children: [
            Expanded(child: FilledButton(onPressed: loading?null:_connectQR, child: const Text('Connect with QR'))),
            const SizedBox(width: 8),
            Expanded(child: OutlinedButton(onPressed: loading?null:_connectPair, child: const Text('Pairing Code'))),
          ]),
          if (pairCode != null) ...[
            const SizedBox(height: 12),
            const Text('Kode Pairing:', style: TextStyle(fontSize: 12)),
            SelectableText(pairCode!, style: const TextStyle(fontSize: 28, fontWeight: FontWeight.bold, letterSpacing: 4, color: Color(0xFF10B981))),
          ],
          if (qrData != null) ...[
            const SizedBox(height: 12),
            const Text('Scan QR:', style: TextStyle(fontSize: 12)),
            const SizedBox(height: 8),
            Center(child: Container(color: Colors.white, padding: const EdgeInsets.all(8), child: QrImageView(data: qrData!, size: 220))),
          ],
          if (msg != null) Padding(padding: const EdgeInsets.only(top: 10), child: Text(msg!, style: const TextStyle(fontSize: 12))),
        ]))),
        const SizedBox(height: 8),
        const Text('Experiment build • sesi & data tersimpan lokal di HP • auto-update via manifest', textAlign: TextAlign.center, style: TextStyle(fontSize: 11, color: Colors.grey)),
      ]),
    );
  }
}