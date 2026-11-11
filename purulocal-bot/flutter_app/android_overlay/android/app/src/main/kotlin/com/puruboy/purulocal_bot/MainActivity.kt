package com.puruboy.purulocal_bot

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import io.flutter.embedding.android.FlutterActivity

class MainActivity : FlutterActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestStoragePermissionIfNeeded()
        // Start backend as foreground service so it can keep running in background
        BackendService.ensureStarted(this)
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
    // Do not kill backend on destroy: service keeps it alive in background
}