package com.puruboy.purulocal_bot

import android.os.Build
import android.os.Bundle
import android.util.Log
import io.flutter.embedding.android.FlutterActivity
import java.io.File
import java.io.FileOutputStream
import java.util.zip.ZipFile

class MainActivity : FlutterActivity() {
    private var backendProcess: Process? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        startLocalBackend()
    }

    private fun findBackendBinary(): File? {
        val nativeDir = applicationInfo.nativeLibraryDir
        val candidates = mutableListOf<File>()
        candidates.add(File(nativeDir, "libpurulocal.so"))
        val parent = File(nativeDir).parentFile
        if (parent != null) {
            candidates.add(File(parent, "arm64-v8a/libpurulocal.so"))
            candidates.add(File(parent, "arm64/libpurulocal.so"))
            candidates.add(File(parent, "armeabi-v7a/libpurulocal.so"))
            parent.listFiles()?.forEach { dir ->
                if (dir.isDirectory) candidates.add(File(dir, "libpurulocal.so"))
            }
        }
        candidates.add(File("/data/data/$packageName/lib/libpurulocal.so"))
        for (c in candidates) {
            try { if (c.exists() && c.canExecute()) return c } catch (_: Exception) {}
        }
        for (c in candidates) {
            try { if (c.exists()) return c } catch (_: Exception) {}
        }

        // Fallback: extract from APK (handles extractNativeLibs=false / non-extracted libs)
        try {
            val extracted = extractBackendFromApk()
            if (extracted != null && extracted.exists()) return extracted
        } catch (e: Exception) {
            Log.e("puruLocal", "Failed to extract backend from APK", e)
        }

        Log.e("puruLocal", "Backend binary not found. nativeLibraryDir=$nativeDir candidates=${candidates.map { it.absolutePath }}")
        return null
    }

    private fun extractBackendFromApk(): File? {
        val outDir = File(filesDir, "purulocal/bin")
        outDir.mkdirs()
        val outFile = File(outDir, "libpurulocal.so")
        val abis = try { Build.SUPPORTED_ABIS?.toList() ?: emptyList() } catch (_: Exception) { emptyList() }
        val apkPath = applicationInfo.sourceDir ?: return null
        ZipFile(apkPath).use { zip ->
            val entries = abis.map { "lib/$it/libpurulocal.so" } +
                listOf("lib/arm64-v8a/libpurulocal.so", "lib/armeabi-v7a/libpurulocal.so", "lib/x86_64/libpurulocal.so")
            for (name in entries.distinct()) {
                val entry = zip.getEntry(name) ?: continue
                // reuse if size matches
                if (outFile.exists() && outFile.length() == entry.size) {
                    outFile.setExecutable(true)
                    Log.i("puruLocal", "Using cached extracted backend: ${outFile.absolutePath}")
                    return outFile
                }
                zip.getInputStream(entry).use { input ->
                    FileOutputStream(outFile).use { output -> input.copyTo(output) }
                }
                outFile.setExecutable(true)
                Log.i("puruLocal", "Extracted backend from APK ($name): ${outFile.absolutePath}")
                return outFile
            }
        }
        return null
    }

    private fun startLocalBackend() {
        try {
            // avoid duplicate if already listening (e.g. debug/manual run)
            if (isPortInUse(8787)) {
                Log.i("puruLocal", "Backend port 8787 already in use, skipping start")
                return
            }
            val bin = findBackendBinary() ?: return
            try { bin.setExecutable(true) } catch (_: Exception) {}

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

    private fun isPortInUse(port: Int): Boolean {
        return try {
            java.net.Socket("127.0.0.1", port).use { true }
        } catch (_: Exception) {
            false
        }
    }

    override fun onDestroy() {
        try { backendProcess?.destroy() } catch (_: Exception) {}
        super.onDestroy()
    }
}