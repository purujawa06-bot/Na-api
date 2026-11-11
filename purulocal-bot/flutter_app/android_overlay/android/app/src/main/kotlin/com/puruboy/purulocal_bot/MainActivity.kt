package com.puruboy.purulocal_bot

import android.os.Bundle
import io.flutter.embedding.android.FlutterActivity

class MainActivity : FlutterActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Start backend as foreground service so it can keep running in background
        BackendService.ensureStarted(this)
    }
    // Do not kill backend on destroy: service keeps it alive in background
}