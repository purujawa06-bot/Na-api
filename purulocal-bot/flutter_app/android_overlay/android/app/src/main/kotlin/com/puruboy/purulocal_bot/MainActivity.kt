package com.puruboy.purulocal_bot

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.File

class MainActivity : FlutterActivity() {
    private val CHANNEL = "purulocal/native"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestStoragePermissionIfNeeded()
        // Start foreground service; backend runtime akan dijalankan setelah payload siap (launcher flow)
        BackendService.ensureStarted(this)
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL).setMethodCallHandler { call, result ->
            when (call.method) {
                "getRuntimeDir" -> {
                    try {
                        val dir = BackendService.getRuntimeBaseDir(this)
                        dir.mkdirs()
                        result.success(dir.absolutePath)
                    } catch (e: Exception) {
                        result.error("err", e.message, null)
                    }
                }
                "getDeviceAbi" -> result.success(BackendService.getDeviceAbi())
                "getInstalledRuntimeVersion" -> result.success(BackendService.getInstalledRuntimeVersion(this))
                "hasRuntimePayload" -> result.success(BackendService.hasRuntimePayload(this))
                "startBackend" -> {
                    try { BackendService.startBackend(this); result.success(true) } catch (e: Exception) { result.error("err", e.message, null) }
                }
                "restartBackend" -> {
                    try { BackendService.restartBackend(); result.success(true) } catch (e: Exception) { result.error("err", e.message, null) }
                }
                "getAppVersionCode" -> {
                    try {
                        val pInfo = packageManager.getPackageInfo(packageName, 0)
                        val code = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) pInfo.longVersionCode.toInt() else @Suppress("DEPRECATION") pInfo.versionCode
                        result.success(code)
                    } catch (e: Exception) { result.success(0) }
                }
                else -> result.notImplemented()
            }
        }
    }

    private fun requestStoragePermissionIfNeeded() {
        try {
            val perms = mutableListOf<String>()
            if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.Q || Build.VERSION.SDK_INT <= 29) {
                if (ContextCompat.checkSelfPermission(this, Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                    perms.add(Manifest.permission.WRITE_EXTERNAL_STORAGE)
                }
                if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                    perms.add(Manifest.permission.READ_EXTERNAL_STORAGE)
                }
            }
            if (Build.VERSION.SDK_INT >= 33) { // TIRAMISU
                if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                    perms.add(Manifest.permission.POST_NOTIFICATIONS)
                }
            }
            if (perms.isNotEmpty()) {
                ActivityCompat.requestPermissions(this, perms.toTypedArray(), 1001)
            }
        } catch (_: Exception) {}
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 1001) {
            val storageGranted = permissions.indices.any { i ->
                (permissions[i] == Manifest.permission.WRITE_EXTERNAL_STORAGE || permissions[i] == Manifest.permission.READ_EXTERNAL_STORAGE) &&
                    i < grantResults.size && grantResults[i] == PackageManager.PERMISSION_GRANTED
            }
            if (storageGranted) {
                try {
                    if (BackendService.hasRuntimePayload(this)) BackendService.restartBackend()
                } catch (_: Exception) {}
            }
        }
    }
    // Do not kill backend on destroy: service keeps it alive in background
}
