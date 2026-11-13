import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:webview_flutter/webview_flutter.dart';
import 'services/update_service.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const PuruLocalApp());
}

class PuruLocalApp extends StatelessWidget {
  const PuruLocalApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'puruLocal Bot',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF10B981), brightness: Brightness.dark),
        useMaterial3: true,
        scaffoldBackgroundColor: const Color(0xFF07090D),
      ),
      home: const ShellScreen(),
    );
  }
}

class ShellScreen extends StatefulWidget {
  const ShellScreen({super.key});
  @override
  State<ShellScreen> createState() => _ShellScreenState();
}

class _ShellScreenState extends State<ShellScreen> {
  static const String localUrl = 'http://127.0.0.1:8787/';
  late final WebViewController _controller;
  bool _loaded = false;
  bool _checkingUpdate = false;
  bool _updatePrompted = false;
  bool _wasLoggedIn = false;
  String _statusLine = 'Menyiapkan UI lokal...';
  Timer? _bootTimer;
  Timer? _updateTimer;

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0xFF07090D))
      ..addJavaScriptChannel('PuruNative', onMessageReceived: (msg) {
        if (msg.message == 'checkUpdate') _manualCheckUpdate();
      })
      ..setNavigationDelegate(NavigationDelegate(
        onPageFinished: (_) { if (mounted) setState(() { _loaded = true; _statusLine = ''; }); },
        onWebResourceError: (_) { _retryLoadLater(); },
      ));
    _tryLoad();
    // cek update saat start dan berkala (termasuk deteksi login)
    Future.delayed(const Duration(seconds: 4), _autoCheckUpdate);
    _updateTimer = Timer.periodic(const Duration(seconds: 30), (_) => _autoCheckUpdate());
  }

  @override
  void dispose() {
    _bootTimer?.cancel();
    _updateTimer?.cancel();
    super.dispose();
  }

  void _tryLoad() async {
    try {
      await _controller.loadRequest(Uri.parse(localUrl));
    } catch (_) {
      _retryLoadLater();
    }
  }

  void _retryLoadLater() {
    _bootTimer?.cancel();
    if (!mounted) return;
    setState(() { _loaded = false; _statusLine = 'Menunggu backend lokal (127.0.0.1:8787)...'; });
    _bootTimer = Timer(const Duration(seconds: 2), _tryLoad);
  }

  // Default manifest (built-in): backend na-api / release rolling menyediakan manifest terbaru
  static const String defaultManifestUrl = 'https://na-api-nue-api-e7bfd3f4.koyeb.app/api/purulocal/update-manifest';

  Future<String> _getManifestUrl() async {
    try {
      final r = await http.get(Uri.parse('${localUrl}api/config')).timeout(const Duration(seconds: 4));
      if (r.statusCode == 200) {
        final j = jsonDecode(r.body);
        final c = (j['config'] ?? {}) as Map<String, dynamic>;
        final u = (c['update_manifest_url'] ?? '').toString().trim();
        if (u.isNotEmpty) return u;
      }
    } catch (_) {}
    // fallback: URL manifest bawaan agar auto-update jalan tanpa konfigurasi manual
    return defaultManifestUrl;
  }

  Future<bool> _isLoggedIn() async {
    try {
      final r = await http.get(Uri.parse('${localUrl}api/status')).timeout(const Duration(seconds: 4));
      if (r.statusCode == 200) {
        final j = jsonDecode(r.body);
        final s = (j['status'] ?? {}) as Map<String, dynamic>;
        return s['logged_in'] == true || s['has_session'] == true;
      }
    } catch (_) {}
    return false;
  }

  Future<void> _autoCheckUpdate() async {
    if (_checkingUpdate || !mounted) return;
    // deteksi transisi login (saat login apk/bot) untuk memicu cek
    final loggedIn = await _isLoggedIn();
    final loginTransition = loggedIn && !_wasLoggedIn;
    _wasLoggedIn = loggedIn || _wasLoggedIn;
    final manifestUrl = await _getManifestUrl();
    if (manifestUrl.isEmpty) return;
    _checkingUpdate = true;
    try {
      final svc = UpdateService(manifestUrl);
      final decision = await svc.checkDecision();
      if (decision.kind == UpdateKind.none || !mounted) return;
      // jika sudah pernah prompt dan tidak force, jangan spam (kecuali transisi login pertama)
      if (_updatePrompted && !decision.info.force && !loginTransition) return;
      _updatePrompted = true;
      if (decision.kind == UpdateKind.runtime) {
        await _applyRuntimeUpdate(svc, decision.info, silent: !loginTransition);
      } else if (decision.kind == UpdateKind.apk) {
        await _showApkUpdateDialog(svc, decision.info);
      }
    } catch (_) {
      // abaikan kegagalan cek otomatis
    } finally {
      _checkingUpdate = false;
    }
  }

  void _notifyWebUpdate(String msg, {bool isErr = false}) {
    final safe = msg.replaceAll("\\", "\\\\").replaceAll("'", "\\'").replaceAll("\n", " ");
    _controller.runJavaScript("window.puruUpdateDone && window.puruUpdateDone('$safe', ${isErr ? 'true' : 'false'})").catchError((_){});
  }

  Future<void> _manualCheckUpdate() async {
    if (_checkingUpdate || !mounted) return;
    final manifestUrl = await _getManifestUrl();
    if (manifestUrl.isEmpty) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('URL manifest tidak tersedia')));
      }
      _notifyWebUpdate('URL manifest tidak tersedia.', isErr: true);
      return;
    }
    _checkingUpdate = true;
    try {
      final svc = UpdateService(manifestUrl);
      final decision = await svc.checkDecision();
      if (!mounted) return;
      if (decision.kind == UpdateKind.none) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Tidak ada update tersedia.')));
        _notifyWebUpdate('Tidak ada update tersedia.');
        return;
      }
      _updatePrompted = true;
      if (decision.kind == UpdateKind.runtime) {
        _notifyWebUpdate('Update fitur/UI tersedia (runtime ${decision.info.runtimeVersion})');
        await _applyRuntimeUpdate(svc, decision.info, silent: false);
      } else {
        _notifyWebUpdate('Update APK tersedia: ${decision.info.versionName}');
        await _showApkUpdateDialog(svc, decision.info);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Gagal cek update: $e')));
      }
      _notifyWebUpdate('Gagal cek update.', isErr: true);
    } finally {
      _checkingUpdate = false;
    }
  }

  Future<void> _applyRuntimeUpdate(UpdateService svc, UpdateInfo info, {bool silent = false}) async {
    if (!mounted) return;
    final doUpdate = info.force ? true : await showDialog<bool>(
      context: context,
      barrierDismissible: !info.force,
      builder: (c) => AlertDialog(
        title: Text('Update tersedia (runtime ${info.runtimeVersion})'),
        content: Text(info.changelog.isEmpty
            ? 'Pembaruan fitur/UI tersedia. Unduh dan terapkan sekarang? (tanpa update APK)'
            : '${info.changelog}\n\nUnduh dan terapkan sekarang? (tanpa update APK)'),
        actions: [
          if (!info.force) TextButton(onPressed: ()=>Navigator.pop(c,false), child: const Text('Nanti')),
          FilledButton(onPressed: ()=>Navigator.pop(c,true), child: const Text('Update')),
        ],
      ),
    );
    if (doUpdate != true || !mounted) return;

    double progress = 0;
    StateSetter? setP;
    showDialog(context: context, barrierDismissible: false, builder: (c) => StatefulBuilder(builder: (c, sp){
      setP = sp;
      return AlertDialog(
        title: const Text('Mengunduh pembaruan...'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          LinearProgressIndicator(value: progress <= 0 ? null : progress),
          const SizedBox(height: 8),
          Text(progress <= 0 ? 'Menyiapkan...' : '${(progress*100).toStringAsFixed(0)}%'),
        ]),
      );
    }));
    try {
      await svc.downloadAndInstallRuntime(info, onProgress: (r,t){ if(t>0){ progress = r/t; setP?.call((){}); } });
      if (mounted) {
        try { Navigator.of(context, rootNavigator: true).pop(); } catch (_) {}
      }
      if (!mounted) return;
      _notifyWebUpdate('Pembaruan runtime ${info.runtimeVersion} diterapkan. Memuat ulang...');
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Pembaruan runtime ${info.runtimeVersion} diterapkan.')));
      // beri waktu backend restart lalu muat ulang UI lokal
      await Future.delayed(const Duration(seconds: 2));
      _tryLoad();
    } catch (e) {
      if (mounted) {
        try { Navigator.of(context, rootNavigator: true).pop(); } catch (_) {}
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Update runtime gagal: $e')));
        _notifyWebUpdate('Update runtime gagal.', isErr: true);
      }
    }
  }

  Future<void> _showApkUpdateDialog(UpdateService svc, UpdateInfo info) async {
    if (!mounted) return;
    final doUpdate = info.force ? true : await showDialog<bool>(
      context: context,
      barrierDismissible: !info.force,
      builder: (c) => AlertDialog(
        title: Text('Update APK tersedia: ${info.versionName} (build ${info.buildNumber})'),
        content: Text(info.changelog.isEmpty ? 'Versi aplikasi baru tersedia. Update APK sekarang?' : info.changelog),
        actions: [
          if (!info.force) TextButton(onPressed: ()=>Navigator.pop(c,false), child: const Text('Nanti')),
          FilledButton(onPressed: ()=>Navigator.pop(c,true), child: const Text('Update')),
        ],
      ),
    );
    if (doUpdate != true || !mounted) return;

    double progress = 0;
    StateSetter? setP;
    showDialog(context: context, barrierDismissible: false, builder: (c) => StatefulBuilder(builder: (c, sp){
      setP = sp;
      return AlertDialog(
        title: const Text('Mengunduh update APK...'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          LinearProgressIndicator(value: progress <= 0 ? null : progress),
          const SizedBox(height: 8),
          Text(progress <= 0 ? 'Menyiapkan...' : '${(progress*100).toStringAsFixed(0)}%'),
        ]),
      );
    }));
    try {
      final file = await svc.download(info, onProgress: (r,t){ if(t>0){ progress = r/t; setP?.call((){}); } });
      if (mounted) Navigator.of(context, rootNavigator: true).pop();
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        barrierDismissible: !info.force,
        builder: (c) => AlertDialog(
          title: const Text('Update APK siap dipasang'),
          content: Text(
            info.changelog.isNotEmpty
                ? 'Versi ${info.versionName} (build ${info.buildNumber}) siap dipasang.\n\n${info.changelog}'
                : 'Versi ${info.versionName} (build ${info.buildNumber}) siap dipasang.',
          ),
          actions: [
            if (!info.force) TextButton(onPressed: ()=>Navigator.pop(c), child: const Text('Nanti')),
            FilledButton(onPressed: () async { await svc.install(file); }, child: const Text('Install')),
          ],
        ),
      );
    } catch (e) {
      if (mounted) {
        try { Navigator.of(context, rootNavigator: true).pop(); } catch (_) {}
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Update APK gagal: $e')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Stack(children: [
          WebViewWidget(controller: _controller),
          if (!_loaded)
            Container(
              color: const Color(0xFF07090D),
              alignment: Alignment.center,
              padding: const EdgeInsets.all(24),
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                const CircularProgressIndicator(color: Color(0xFF10B981)),
                const SizedBox(height: 16),
                Text(_statusLine, textAlign: TextAlign.center, style: const TextStyle(color: Color(0xFF8B949E))),
                const SizedBox(height: 12),
                TextButton(onPressed: _tryLoad, child: const Text('Coba lagi')),
              ]),
            ),
        ]),
      ),
    );
  }
}
