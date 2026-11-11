import 'dart:async';
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
  final pluginServer = TextEditingController(text: 'https://na-api-nue-api-e7bfd3f4.koyeb.app');
  bool blockSelf = true;
  bool readChat = false;
  bool typingBeforeReply = true;
  double typingDelaySec = 1.5;

  bool backendOk = false;
  bool connected = false;
  bool loggedIn = false;
  bool hasSession = false;
  bool paused = false;
  String jid = '';
  String statusText = 'Memuat...';

  String? qrData;
  String? pairCode;
  String? msg;
  bool loading = false;
  bool _configLoaded = false;

  List<dynamic> installedPlugins = [];
  List<dynamic> availablePlugins = [];
  Timer? _autoRefresh;

  @override
  void initState() {
    super.initState();
    _load(full: true);
    _autoRefresh = Timer.periodic(const Duration(seconds: 5), (_) => _load(full: false));
  }

  @override
  void dispose() {
    _autoRefresh?.cancel();
    botName.dispose();
    ownerName.dispose();
    ownerNumber.dispose();
    botNumber.dispose();
    pluginServer.dispose();
    super.dispose();
  }

  Future<void> _load({bool full = false}) async {
    try {
      final s = await api.status();
      final c = BotConfig.fromJson((s['config'] ?? {}) as Map<String, dynamic>);
      final st = (s['status'] ?? {}) as Map<String, dynamic>;
      final con = st['connected'] == true;
      final lin = st['logged_in'] == true;
      final hs = st['has_session'] == true || lin;
      final pau = st['paused'] == true;
      List<dynamic> plugs = [];
      try { plugs = await api.plugins(); } catch (_) {}
      if (!mounted) return;
      setState(() {
        backendOk = true;
        connected = con;
        loggedIn = lin;
        hasSession = hs;
        paused = pau;
        jid = (st['jid'] ?? '').toString();
        installedPlugins = plugs;
        statusText = 'Connected: $con · Logged in: $lin${pau ? ' · Paused' : ''}${jid.isNotEmpty ? '\n$jid' : ''}';
        // update form/config values pada load awal atau refresh manual penuh
        if (full || !_configLoaded) {
          botName.text = c.botName;
          ownerName.text = c.ownerName;
          ownerNumber.text = c.ownerNumber;
          botNumber.text = c.botNumber;
          blockSelf = c.blockSelfChat;
        }
        readChat = c.readChat;
        typingBeforeReply = c.typingBeforeReply;
        typingDelaySec = c.typingDelaySec;
        _configLoaded = true;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        backendOk = false;
        connected = false;
        loggedIn = false;
        hasSession = false;
        paused = false;
        statusText = 'Backend lokal belum aktif.\n$e';
      });
    }
  }

  BotConfig _cfg() => BotConfig(
        botName: botName.text.trim().isEmpty ? 'puruLocal Bot' : botName.text.trim(),
        ownerName: ownerName.text.trim(),
        ownerNumber: ownerNumber.text.trim(),
        botNumber: botNumber.text.trim().isEmpty ? ownerNumber.text.trim() : botNumber.text.trim(),
        blockSelfChat: blockSelf,
        readChat: readChat,
        typingBeforeReply: typingBeforeReply,
        typingDelaySec: typingDelaySec,
      );

  Future<void> _save() async {
    setState(() { loading = true; msg = null; });
    try {
      await api.saveConfig(_cfg());
      setState(() => msg = 'Konfigurasi tersimpan.');
    } catch (e) {
      setState(() => msg = 'Gagal: $e');
    } finally { setState(() => loading = false); _load(full: true); }
  }

  Future<void> _connectQR() async {
    await _save();
    setState(() { loading = true; msg = 'Meminta QR...'; pairCode = null; });
    try {
      final code = await api.connectQR();
      setState(() { qrData = code; msg = 'Scan QR dari WhatsApp > Perangkat tertaut.'; });
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
      setState(() { pairCode = code; msg = 'Masukkan kode di WhatsApp > Perangkat tertaut.'; });
    } catch (e) {
      setState(() => msg = 'Pairing gagal: $e');
    } finally { setState(() => loading = false); }
  }

  Future<void> _pause() async {
    setState(() { loading = true; msg = null; });
    try { await api.pause(); msg = 'Bot dipause.'; } catch (e) { msg = 'Gagal: $e'; }
    await _load(full: false);
    setState(() => loading = false);
  }

  Future<void> _start() async {
    setState(() { loading = true; msg = null; });
    try { await api.start(); msg = 'Bot dijalankan.'; } catch (e) { msg = 'Gagal: $e'; }
    await _load(full: false);
    setState(() => loading = false);
  }

  Future<void> _logout() async {
    final ok = await showDialog<bool>(context: context, builder: (c) => AlertDialog(
      title: const Text('Logout'),
      content: const Text('Hapus sesi WhatsApp dari perangkat ini?'),
      actions: [
        TextButton(onPressed: ()=>Navigator.pop(c,false), child: const Text('Batal')),
        FilledButton(onPressed: ()=>Navigator.pop(c,true), child: const Text('Logout')),
      ],
    ));
    if (ok != true) return;
    setState(() { loading = true; msg = null; qrData = null; pairCode = null; });
    try { await api.logout(); msg = 'Logout berhasil.'; } catch (e) { msg = 'Gagal: $e'; }
    await _load(full: true);
    setState(() => loading = false);
  }

  Future<void> _loadAvailable() async {
    setState(() { loading = true; msg = null; });
    try {
      final server = pluginServer.text.trim().isEmpty ? 'https://na-api-nue-api-e7bfd3f4.koyeb.app' : pluginServer.text.trim();
      final list = await api.availablePlugins(server: server);
      setState(() { availablePlugins = list; msg = 'Plugin server dimuat.'; });
    } catch (e) {
      setState(() => msg = 'Gagal memuat plugin: $e');
    } finally { setState(() => loading = false); }
  }

  Future<void> _installPlugin(Map<String, dynamic> p) async {
    setState(() { loading = true; msg = null; });
    try {
      await api.installPlugin(p);
      msg = 'Plugin .${p['command']} terpasang.';
      availablePlugins = [];
      await _load(full: false);
    } catch (e) { msg = 'Gagal install: $e'; }
    setState(() => loading = false);
  }

  Future<void> _removePlugin(String id) async {
    setState(() { loading = true; msg = null; });
    try {
      await api.removePlugin(id);
      msg = 'Plugin dihapus.';
      await _load(full: false);
    } catch (e) { msg = 'Gagal hapus: $e'; }
    setState(() => loading = false);
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

  Widget _statusCard() {
    return Card(child: Padding(padding: const EdgeInsets.all(12), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      const Text('Status', style: TextStyle(fontWeight: FontWeight.bold)),
      const SizedBox(height: 6), Text(statusText, style: const TextStyle(fontSize: 12)),
      if (msg != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(msg!, style: const TextStyle(fontSize: 12, color: Color(0xFF10B981)))),
    ])));
  }

  Widget _pluginsCard() {
    return Card(child: Padding(padding: const EdgeInsets.all(12), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      const Text('Plugin', style: TextStyle(fontWeight: FontWeight.bold)),
      const SizedBox(height: 6),
      if (installedPlugins.isEmpty) const Text('Belum ada plugin terpasang.', style: TextStyle(fontSize: 12, color: Colors.grey)),
      ...installedPlugins.map((p) {
        final m = (p as Map).cast<String, dynamic>();
        final id = (m['id'] ?? m['command'] ?? '').toString();
        final cmd = (m['command'] ?? '').toString();
        final name = (m['name'] ?? cmd).toString();
        final cat = (m['category'] ?? '').toString();
        final desc = (m['description'] ?? '').toString();
        return ListTile(
          contentPadding: EdgeInsets.zero,
          dense: true,
          title: Text('$name (.${cmd.isEmpty ? id : cmd})', style: const TextStyle(fontSize: 13)),
          subtitle: Text('${cat.isNotEmpty ? '[$cat] ' : ''}$desc', style: const TextStyle(fontSize: 11)),
          trailing: IconButton(icon: const Icon(Icons.delete_outline, color: Colors.redAccent), onPressed: loading?null:()=>_removePlugin(id)),
        );
      }),
      const Divider(height: 16),
      TextField(controller: pluginServer, decoration: const InputDecoration(labelText: 'Server plugin (na-api)', isDense: true)),
      const SizedBox(height: 8),
      SizedBox(width: double.infinity, child: OutlinedButton(onPressed: loading?null:_loadAvailable, child: const Text('Muat Plugin dari Server'))),
      ...availablePlugins.map((p) {
        final m = (p as Map).cast<String, dynamic>();
        final cmd = (m['command'] ?? '').toString();
        final name = (m['name'] ?? cmd).toString();
        final cat = (m['category'] ?? '').toString();
        return ListTile(
          contentPadding: EdgeInsets.zero,
          dense: true,
          title: Text('$name (.${cmd})', style: const TextStyle(fontSize: 13)),
          subtitle: Text('${cat.isNotEmpty ? '[$cat] ' : ''}${m['description'] ?? ''}', style: const TextStyle(fontSize: 11)),
          trailing: FilledButton(onPressed: loading?null:()=>_installPlugin(m), child: const Text('Install')),
        );
      }),
    ])));
  }

  Widget _settingsCard() {
    return Card(child: Padding(padding: const EdgeInsets.all(12), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      const Text('Settings', style: TextStyle(fontWeight: FontWeight.bold)),
      SwitchListTile(
        contentPadding: EdgeInsets.zero,
        title: const Text('Bot read chat'),
        subtitle: const Text('Tandai pesan masuk sebagai dibaca'),
        value: readChat,
        onChanged: loading ? null : (v) async { setState(() => readChat = v); await _save(); },
      ),
      SwitchListTile(
        contentPadding: EdgeInsets.zero,
        title: const Text('Bot status mengetik'),
        subtitle: const Text('Kirim status mengetik 1.5 detik sebelum membalas command'),
        value: typingBeforeReply,
        onChanged: loading ? null : (v) async { setState(() => typingBeforeReply = v); await _save(); },
      ),
    ])));
  }

  Widget _controlView() {
    return ListView(padding: const EdgeInsets.all(16), children: [
      _statusCard(),
      Card(child: Padding(padding: const EdgeInsets.all(12), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const Text('Dashboard', style: TextStyle(fontWeight: FontWeight.bold)),
        const SizedBox(height: 10),
        FilledButton(onPressed: loading?null:_pause, child: Text(paused ? 'Pause (aktif)' : 'Pause')),
        const SizedBox(height: 8),
        FilledButton(onPressed: loading?null:_start, child: Text(!paused ? 'Start (aktif)' : 'Start')),
        const SizedBox(height: 8),
        OutlinedButton(onPressed: loading?null:_logout, child: const Text('Logout')),
      ]))),
      _settingsCard(),
      _pluginsCard(),
      const SizedBox(height: 8),
      const Text('Bot berjalan lokal di HP • auto-refresh 5 detik', textAlign: TextAlign.center, style: TextStyle(fontSize: 11, color: Colors.grey)),
    ]);
  }

  Widget _setupView() {
    return ListView(padding: const EdgeInsets.all(16), children: [
      _statusCard(),
      Card(child: Padding(padding: const EdgeInsets.all(12), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Text('Konfigurasi Dasar', style: TextStyle(fontWeight: FontWeight.bold)),
        TextField(controller: botName, decoration: const InputDecoration(labelText: 'Nama Bot')),
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
      ]))),
      _pluginsCard(),
      const SizedBox(height: 8),
      const Text('Sesi & data tersimpan lokal di HP • auto-update via manifest', textAlign: TextAlign.center, style: TextStyle(fontSize: 11, color: Colors.grey)),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    final connectedMode = backendOk && (hasSession || loggedIn);
    return Scaffold(
      appBar: AppBar(title: const Text('puruLocal Bot'), actions: [
        IconButton(onPressed: loading?null:()=>_load(full: true), icon: const Icon(Icons.refresh)),
        IconButton(onPressed: loading?null:_checkUpdate, icon: const Icon(Icons.system_update)),
      ]),
      body: connectedMode ? _controlView() : _setupView(),
    );
  }
}