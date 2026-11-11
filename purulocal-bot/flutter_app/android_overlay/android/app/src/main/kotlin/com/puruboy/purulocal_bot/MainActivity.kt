package com.puruboy.purulocal_bot

import android.os.Bundle
import android.util.Log
import io.flutter.embedding.android.FlutterActivity
import java.io.File

class MainActivity : FlutterActivity() {
    private var backendProcess: Process? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        startLocalBackend()
    }

    private fun startLocalBackend() {
        try {
            val nativeDir = applicationInfo.nativeLibraryDir
            val bin = File(nativeDir, "libpurulocal.so")
            if (!bin.exists()) {
                Log.e("puruLocal", "Backend binary not found: ${bin.absolutePath}")
                return
            }
            bin.setExecutable(true)
            val dataDir = File(filesDir, "purulocal")
            dataDir.mkdirs()
            val cfg = File(dataDir, "config.json").absolutePath
            val storeDir = File(dataDir, "data")
            storeDir.mkdirs()

            val pb = ProcessBuilder(bin.absolutePath)
            pb.redirectErrorStream(true)
            val env = pb.environment()
            env["PURULOCAL_ADDR"] = "127.0.0.1:8787"
            env["PURULOCAL_CONFIG"] = cfg
            env["PURULOCAL_DATA"] = storeDir.absolutePath
            pb.directory(dataDir)
            backendProcess = pb.start()

            // Drain output to avoid blocking
            Thread {
                try {
                    backendProcess?.inputStream?.bufferedReader()?.useLines { lines ->
                        lines.forEach { Log.i("puruLocal-backend", it) }
                    }
                } catch (_: Exception) {}
            }.start()
            Log.i("puruLocal", "Local backend started: ${bin.absolutePath}")
        } catch (e: Exception) {
            Log.e("puruLocal", "Failed to start backend", e)
        }
    }

    override fun onDestroy() {
        try { backendProcess?.destroy() } catch (_: Exception) {}
        super.onDestroy()
    }
}