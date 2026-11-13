import 'dart:convert';
import 'dart:io';
import 'package:crypto/crypto.dart';
import 'package:dio/dio.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:package_info_plus/package_info_plus.dart';

class UpdateInfo {
  final String versionName;
  final int buildNumber;
  final String apkUrl;
  final String sha256;
  final bool force;
  final String changelog;
  final int runtimeVersion;
  final String runtimeUrl;
  final String runtimeSha256;
  final int minShellBuild;

  UpdateInfo({
    required this.versionName,
    required this.buildNumber,
    required this.apkUrl,
    required this.sha256,
    required this.force,
    required this.changelog,
    required this.runtimeVersion,
    required this.runtimeUrl,
    required this.runtimeSha256,
    required this.minShellBuild,
  });

  bool get hasRuntime => runtimeVersion > 0 && runtimeUrl.isNotEmpty;
}

enum UpdateKind { runtime, apk, none }

class UpdateDecision {
  final UpdateKind kind;
  final UpdateInfo info;
  final int localApkBuild;
  final int localRuntimeVersion;
  UpdateDecision({required this.kind, required this.info, required this.localApkBuild, required this.localRuntimeVersion});
}

class UpdateService {
  final String manifestUrl;
  final Dio _dio = Dio(BaseOptions(connectTimeout: const Duration(seconds: 20), receiveTimeout: const Duration(seconds: 120)));
  static const _native = MethodChannel('purulocal/native');
  UpdateService(this.manifestUrl);

  Future<int> getInstalledRuntimeVersion() async {
    try { return (await _native.invokeMethod<int>('getInstalledRuntimeVersion')) ?? 0; } catch (_) { return 0; }
  }

  Future<bool> hasRuntimePayload() async {
    try { return (await _native.invokeMethod<bool>('hasRuntimePayload')) ?? false; } catch (_) { return false; }
  }

  Future<UpdateDecision> checkDecision() async {
    final info = await _fetchInfo();
    final pkg = await PackageInfo.fromPlatform();
    final localBuild = int.tryParse(pkg.buildNumber) ?? 0;
    final localRuntime = await getInstalledRuntimeVersion();

    if (info == null) {
      return UpdateDecision(kind: UpdateKind.none, info: _emptyInfo(), localApkBuild: localBuild, localRuntimeVersion: localRuntime);
    }

    if (info.hasRuntime && localBuild >= info.minShellBuild && info.runtimeVersion > localRuntime) {
      return UpdateDecision(kind: UpdateKind.runtime, info: info, localApkBuild: localBuild, localRuntimeVersion: localRuntime);
    }
    if (info.hasRuntime && localRuntime <= 0 && localBuild >= info.minShellBuild) {
      return UpdateDecision(kind: UpdateKind.runtime, info: info, localApkBuild: localBuild, localRuntimeVersion: localRuntime);
    }
    if (info.buildNumber > 0 && info.minShellBuild > localBuild) {
      return UpdateDecision(kind: UpdateKind.apk, info: info, localApkBuild: localBuild, localRuntimeVersion: localRuntime);
    }
    return UpdateDecision(kind: UpdateKind.none, info: info, localApkBuild: localBuild, localRuntimeVersion: localRuntime);
  }

  Future<UpdateInfo?> _fetchInfo() async {
    if (manifestUrl.isEmpty) return null;
    try {
      final res = await http.get(Uri.parse(manifestUrl)).timeout(const Duration(seconds: 15));
      if (res.statusCode != 200) return null;
      final j = jsonDecode(res.body) as Map<String, dynamic>;

      String runtimeUrl = (j['runtimeUrl'] ?? '').toString();
      String runtimeSha = (j['runtimeSha256'] ?? j['runtime_sha256'] ?? '').toString().toLowerCase();
      try {
        if ((runtimeUrl.isEmpty) && j['runtime'] is Map) {
          final rt = j['runtime'] as Map;
          String abi = 'arm64-v8a';
          try { abi = (await _native.invokeMethod<String>('getDeviceAbi')) ?? abi; } catch (_) {}
          Map? entry;
          if (rt[abi] is Map) {
            entry = rt[abi] as Map;
          } else if (rt.isNotEmpty) {
            for (final k in rt.keys) {
              if (abi.contains(k.toString()) || k.toString().contains(abi)) { entry = rt[k] as Map?; break; }
            }
            entry ??= rt.values.first is Map ? rt.values.first as Map : null;
          }
          if (entry != null) {
            runtimeUrl = (entry['url'] ?? entry['apkUrl'] ?? '').toString();
            runtimeSha = (entry['sha256'] ?? '').toString().toLowerCase();
          }
        }
      } catch (_) {}

      final runtimeVersion = _asInt(j['runtimeVersion'] ?? j['runtime_version'] ?? j['runtimeBuild'] ?? 0);
      final minShellBuild = _asInt(j['minShellBuild'] ?? j['min_shell_build'] ?? j['minBuild'] ?? 1);

      return UpdateInfo(
        versionName: (j['versionName'] ?? j['version_name'] ?? '').toString(),
        buildNumber: _asInt(j['buildNumber'] ?? j['build_number'] ?? 0),
        apkUrl: (j['apkUrl'] ?? j['apk_url'] ?? '').toString(),
        sha256: (j['sha256'] ?? '').toString().toLowerCase(),
        force: j['force'] == true,
        changelog: (j['changelog'] ?? '').toString(),
        runtimeVersion: runtimeVersion,
        runtimeUrl: runtimeUrl,
        runtimeSha256: runtimeSha,
        minShellBuild: minShellBuild,
      );
    } catch (_) { return null; }
  }

  int _asInt(dynamic v) {
    if (v is int) return v;
    if (v is num) return v.toInt();
    return int.tryParse(v.toString()) ?? 0;
  }

  UpdateInfo _emptyInfo() => UpdateInfo(versionName: '', buildNumber: 0, apkUrl: '', sha256: '', force: false, changelog: '', runtimeVersion: 0, runtimeUrl: '', runtimeSha256: '', minShellBuild: 1);

  Future<int> downloadAndInstallRuntime(UpdateInfo u, {void Function(int, int)? onProgress}) async {
    if (!u.hasRuntime) throw Exception('Runtime payload tidak tersedia');
    String runtimeDirPath = '';
    try { runtimeDirPath = (await _native.invokeMethod<String>('getRuntimeDir')) ?? ''; } catch (_) {}
    if (runtimeDirPath.isEmpty) throw Exception('Gagal menentukan direktori runtime');

    final runtimeDir = Directory(runtimeDirPath);
    final tmpDir = Directory(runtimeDir.path + '/tmp');
    final currentDir = Directory(runtimeDir.path + '/current');
    final backupDir = Directory(runtimeDir.path + '/backup');
    if (!await tmpDir.exists()) await tmpDir.create(recursive: true);

    String fname = 'libpurulocal.so';
    try {
      final seg = Uri.parse(u.runtimeUrl).pathSegments;
      if (seg.isNotEmpty && seg.last.contains('purulocal')) fname = seg.last;
    } catch (_) {}
    final tmpFile = File(tmpDir.path + '/' + fname);
    try { if (await tmpFile.exists()) await tmpFile.delete(); } catch (_) {}

    await _dio.download(u.runtimeUrl, tmpFile.path, onReceiveProgress: onProgress, deleteOnError: true);
    if (u.runtimeSha256.isNotEmpty) {
      final bytes = await tmpFile.readAsBytes();
      final digest = sha256.convert(bytes).toString();
      if (digest != u.runtimeSha256) {
        try { await tmpFile.delete(); } catch (_) {}
        throw Exception('Checksum runtime SHA-256 tidak cocok');
      }
    }

    final stagingDir = Directory(runtimeDir.path + '/staging');
    try { if (await stagingDir.exists()) await stagingDir.delete(recursive: true); } catch (_) {}
    await stagingDir.create(recursive: true);
    final stagedBin = File(stagingDir.path + '/libpurulocal.so');
    await tmpFile.copy(stagedBin.path);
    try { await tmpFile.delete(); } catch (_) {}
    try {
      final len = await stagedBin.length();
      if (len < 1024) throw Exception('File runtime tidak valid');
    } catch (e) {
      try { await stagingDir.delete(recursive: true); } catch (_) {}
      rethrow;
    }
    try {
      if (Platform.isAndroid || Platform.isLinux) {
        await Process.run('chmod', ['755', stagedBin.path]);
      }
    } catch (_) {}
    final meta = File(stagingDir.path + '/runtime.json');
    await meta.writeAsString(jsonEncode({
      'version': u.runtimeVersion,
      'sha256': u.runtimeSha256,
      'versionName': u.versionName,
      'installedAt': DateTime.now().toIso8601String(),
    }));

    try { if (await backupDir.exists()) await backupDir.delete(recursive: true); } catch (_) {}
    try { if (await currentDir.exists()) { await currentDir.rename(backupDir.path); } } catch (_) {
      try { if (await backupDir.exists()) await backupDir.delete(recursive: true); } catch (_) {}
      try { if (await currentDir.exists()) await currentDir.rename(backupDir.path); } catch (_) {}
    }
    try { await stagingDir.rename(currentDir.path); } catch (_) {
      if (!await currentDir.exists()) await currentDir.create(recursive: true);
      await stagedBin.copy(currentDir.path + '/libpurulocal.so');
      await meta.copy(currentDir.path + '/runtime.json');
      try { await stagingDir.delete(recursive: true); } catch (_) {}
    }

    try { await _native.invokeMethod('restartBackend'); } catch (_) {}
    return u.runtimeVersion;
  }
}
