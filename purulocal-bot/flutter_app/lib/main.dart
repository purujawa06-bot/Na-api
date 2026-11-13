import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
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

enum BootPhase { checking, downloading, starting, ready, error }

class ShellScreen extends StatefulWidget {
  const ShellScreen({super.key});
  @override
  State<ShellScreen> createState() => _ShellScreenState();
}

class _ShellScreenState extends State<ShellScreen> {
  static const String localUrl = 'http://127.0.0.1:8787/';
  static const MethodChannel _native = MethodChannel('purulocal/native');
  // Manifest runtime rolling (payload backend+UI) — APK hanya untuk perubahan arsitektur shell
  static const String defaultManifestUrl = 'https://github.com/purujawa06-bot/Na-api/releases/download/purulocal-experiment/update-manifest.json';

  late final WebViewController _controller;
  BootPhase _phase = BootPhase.checking;
  String _status = 'Memeriksa data...';
  String _detail = '';
  double _progress = -1;
  bool _webReady = false;
  Timer? _periodicTimer;

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0xFF07090D))
      ..addJavaScriptChannel('PuruNative', onMessageReceived: (_) {
        // APK launcher murni: update UI/fitur dikelola otomatis via runtime, tanpa prompt
      })
      ..setNavigationDelegate(NavigationDelegate(
        onPageFinished: (_) { if (mounted) setState(() { _webReady = true; }); },
        onWebResourceError: (_) { _retryWebLoad(); },
      ));
    _boot();
  }

  @override
  void dispose() {
    _periodicTimer?.cancel();
    super.dispose();
  }

  void _set(BootPhase p, String s, {String d = '', double prog = -1}) {
    if (!mounted) return;
    setState(() { _phase = p; _status = s; _detail = d; _progress = prog; });
  }

  Future<void> _boot() async {
    _set(BootPhase.checking, 'Menyiapkan...', d: 'Memeriksa runtime');
    final svc = UpdateService(defaultManifestUrl);
    try {
      final decision = await svc.checkDecision();
      if (decision.kind == UpdateKind.runtime) {
        _set(BootPhase.downloading, 'Mengunduh data...', d: 'Menyiapkan komponen', prog: 0);
        try {
          await svc.downloadAndInstallRuntime(decision.info, onProgress: (r, t) {
            if (t > 0 && mounted) {
              final pct = (100 * r / t).clamp(0, 100).toStringAsFixed(0);
              setState(() { _progress = r / t; _detail = 'Mengunduh data... $pct%'; });
            }
          });
        } catch (e) {
          final has = await svc.hasRuntimePayload();
          if (!has) {
            _set(BootPhase.error, 'Gagal mengunduh data', d: '$e');
            return;
          }
        }
      } else {
        final has = await svc.hasRuntimePayload();
        if (!has) {
          _set(BootPhase.error, 'Data belum tersedia', d: 'Periksa koneksi internet lalu coba lagi.');
          return;
        }
      }
    } catch (_) {
      final has = await svc.hasRuntimePayload();
      if (!has) {
        _set(BootPhase.error, 'Data belum tersedia', d: 'Periksa koneksi internet lalu coba lagi.');
        return;
      }
    }

    _set(BootPhase.starting, 'Memuat...', d: 'Menjalankan layanan');
    try { await _native.invokeMethod('startBackend'); } catch (_) {}
    await _waitBackendReady();
  }

  Future<void> _waitBackendReady() async {
    final deadline = DateTime.now().add(const Duration(seconds: 45));
    while (DateTime.now().isBefore(deadline)) {
      try {
        final r = await http.get(Uri.parse('${localUrl}api/status')).timeout(const Duration(seconds: 2));
        if (r.statusCode == 200) {
          if (!mounted) return;
          _set(BootPhase.ready, '', d: '', prog: -1);
          try { await _controller.loadRequest(Uri.parse(localUrl)); } catch (_) {}
          _startPeriodicRuntimeCheck();
          return;
        }
      } catch (_) {}
      await Future.delayed(const Duration(milliseconds: 700));
      if (mounted && _phase == BootPhase.starting) {
        setState(() { _detail = 'Menunggu layanan siap...'; });
      }
    }
    if (!mounted) return;
    _set(BootPhase.ready, '', d: '', prog: -1);
    try { await _controller.loadRequest(Uri.parse(localUrl)); } catch (_) {}
    _retryWebLoad();
    _startPeriodicRuntimeCheck();
  }

  void _retryWebLoad() {
    if (!mounted || _phase != BootPhase.ready) return;
    Future.delayed(const Duration(seconds: 2), () async {
      if (!mounted || _phase != BootPhase.ready || _webReady) return;
      try { await _controller.loadRequest(Uri.parse(localUrl)); } catch (_) {}
      _retryWebLoad();
    });
  }

  void _startPeriodicRuntimeCheck() {
    _periodicTimer?.cancel();
    _periodicTimer = Timer.periodic(const Duration(minutes: 10), (_) async {
      try {
        final svc = UpdateService(defaultManifestUrl);
        final decision = await svc.checkDecision();
        if (decision.kind == UpdateKind.runtime) {
          await svc.downloadAndInstallRuntime(decision.info);
          await Future.delayed(const Duration(seconds: 2));
          if (mounted) {
            _webReady = false;
            try { await _controller.loadRequest(Uri.parse(localUrl)); } catch (_) {}
          }
        }
      } catch (_) {}
    });
  }

  Widget _splash() {
    final showProgress = _phase == BootPhase.downloading || _phase == BootPhase.starting || _phase == BootPhase.checking;
    return Container(
      color: const Color(0xFF07090D),
      alignment: Alignment.center,
      padding: const EdgeInsets.all(28),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(24),
            child: Image.asset('assets/icon.jpg', width: 96, height: 96, fit: BoxFit.cover,
              errorBuilder: (_, __, ___) => Container(
                width: 96, height: 96,
                decoration: BoxDecoration(color: const Color(0xFF10B981), borderRadius: BorderRadius.circular(24)),
                alignment: Alignment.center,
                child: const Text('P', style: TextStyle(fontSize: 42, fontWeight: FontWeight.w700, color: Colors.black)),
              ),
            ),
          ),
          const SizedBox(height: 18),
          const Text('puruLocal', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: Colors.white)),
          const SizedBox(height: 22),
          if (showProgress) ...[
            SizedBox(
              width: 220,
              child: LinearProgressIndicator(
                value: _progress >= 0 ? _progress.clamp(0.0, 1.0) : null,
                color: const Color(0xFF10B981),
                backgroundColor: const Color(0xFF1F2937),
              ),
            ),
            const SizedBox(height: 12),
          ],
          Text(_status, textAlign: TextAlign.center, style: const TextStyle(color: Color(0xFFE5E7EB), fontSize: 15, fontWeight: FontWeight.w500)),
          if (_detail.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(_detail, textAlign: TextAlign.center, style: const TextStyle(color: Color(0xFF8B949E), fontSize: 13)),
          ],
          if (_phase == BootPhase.error) ...[
            const SizedBox(height: 16),
            FilledButton(
              onPressed: () { _webReady = false; _boot(); },
              child: const Text('Coba lagi'),
            ),
          ],
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final showWeb = _phase == BootPhase.ready;
    return Scaffold(
      body: SafeArea(
        child: Stack(children: [
          if (showWeb) WebViewWidget(controller: _controller),
          if (!showWeb || !_webReady) _splash(),
        ]),
      ),
    );
  }
}
