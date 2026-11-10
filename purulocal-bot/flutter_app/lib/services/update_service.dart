import 'dart:convert';
import 'dart:io';
import 'package:crypto/crypto.dart';
import 'package:dio/dio.dart';
import 'package:http/http.dart' as http;
import 'package:package_info_plus/package_info_plus.dart';
import 'package:path_provider/path_provider.dart';
import 'package:open_filex/open_filex.dart';

class UpdateInfo {
  final String versionName;
  final int buildNumber;
  final String apkUrl;
  final String sha256;
  final bool force;
  final String changelog;
  UpdateInfo({required this.versionName, required this.buildNumber, required this.apkUrl, required this.sha256, required this.force, required this.changelog});
}

/// Auto-update ala Flutter APK (OTA): cek manifest -> download -> verifikasi -> install.
class UpdateService {
  final String manifestUrl;
  final Dio _dio = Dio();
  UpdateService(this.manifestUrl);

  Future<UpdateInfo?> check() async {
    if (manifestUrl.isEmpty) return null;
    final res = await http.get(Uri.parse(manifestUrl));
    if (res.statusCode != 200) return null;
    final j = jsonDecode(res.body);
    final remoteBuild = (j['buildNumber'] ?? 0) as int;
    final info = await PackageInfo.fromPlatform();
    final localBuild = int.tryParse(info.buildNumber) ?? 0;
    if (remoteBuild <= localBuild) return null;
    return UpdateInfo(
      versionName: (j['versionName'] ?? '').toString(),
      buildNumber: remoteBuild,
      apkUrl: (j['apkUrl'] ?? '').toString(),
      sha256: (j['sha256'] ?? '').toString().toLowerCase(),
      force: j['force'] == true,
      changelog: (j['changelog'] ?? '').toString(),
    );
  }

  Future<File> download(UpdateInfo u, {void Function(int, int)? onProgress}) async {
    final dir = await getExternalStorageDirectory() ?? await getTemporaryDirectory();
    final file = File('${dir.path}/puruLocalBot-${u.buildNumber}.apk');
    await _dio.download(u.apkUrl, file.path, onReceiveProgress: onProgress, deleteOnError: true);
    if (u.sha256.isNotEmpty) {
      final bytes = await file.readAsBytes();
      final digest = sha256.convert(bytes).toString();
      if (digest != u.sha256) {
        await file.delete();
        throw Exception('Checksum SHA-256 tidak cocok');
      }
    }
    return file;
  }

  Future<void> install(File apk) async {
    // Memicu installer sistem (butuh izin install unknown apps / REQUEST_INSTALL_PACKAGES)
    await OpenFilex.open(apk.path, type: 'application/vnd.android.package-archive');
  }
}