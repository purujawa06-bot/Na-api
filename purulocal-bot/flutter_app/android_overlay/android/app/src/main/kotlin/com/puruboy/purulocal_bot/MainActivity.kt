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
        val dirs = listOf(
            File(codeCacheDir, "purulocal"),
            File(filesDir, "purulocal/bin"),
            File(cacheDir, "purulocal")
        )
        val abis = try { Build.SUPPORTED_ABIS?.toList() ?: emptyList() } catch (_: Exception) { emptyList() }
        val apkPath = applicationInfo.sourceDir ?: return null
        val names = (abis.map { "lib/$it/libpurulocal.so" } +
            listOf("lib/arm64-v8a/libpurulocal.so", "lib/armeabi-v7a/libpurulocal.so", "lib/x86_64/libpurulocal.so")).distinct()

        for (outDir in dirs) {
            try {
                outDir.mkdirs()
                val outFile = File(outDir, "libpurulocal.so")
                ZipFile(apkPath).use { zip ->
                    for (name in names) {
                        val entry = zip.getEntry(name) ?: continue
                        if (!outFile.exists() || outFile.length() != entry.size) {
                            zip.getInputStream(entry).use { input ->
                                FileOutputStream(outFile).use { output -> input.copyTo(output) }
                            }
                            Log.i("puruLocal", "Extracted backend from APK ($name) to ${outFile.absolutePath}")
                        } else {
                            Log.i("puruLocal", "Using cached extracted backend: ${outFile.absolutePath}")
                        }
                        outFile.setReadable(true, true)
                        outFile.setExecutable(true, false)
                        try { Runtime.getRuntime().exec(arrayOf("chmod", "755", outFile.absolutePath)).waitFor() } catch (_: Exception) {}
                        return outFile
                    }
                }
            } catch (e: Exception) {
                Log.e("puruLocal", "Extract failed for dir ${outDir.absolutePath}", e)
            }
        }
        Log.e("puruLocal", "extractBackendFromApk: no libpurulocal.so found in APK $apkPath for abis=$abis")
        return null
    }

    private fun startLocalBackend() {
        Thread {
            try {
                if (isPortInUse(8787)) {
                    Log.i("puruLocal", "Backend port 8787 already in use, skipping start")
                    return@Thread
                }
                Log.i("puruLocal", "Starting local backend. nativeLibraryDir=${applicationInfo.nativeLibraryDir} sourceDir=${applicationInfo.sourceDir} abi=${Build.SUPPORTED_ABIS?.joinToString()}")
                val bin = findBackendBinary() ?: run {
                    Log.e("puruLocal", "No backend binary available")
                    return@Thread
                }
                try { bin.setReadable(true, true); bin.setExecutable(true, false) } catch (_: Exception) {}
                try { Runtime.getRuntime().exec(arrayOf("chmod", "755", bin.absolutePath)).waitFor() } catch (_: Exception) {}
                Log.i("puruLocal", "Using backend binary: ${bin.absolutePath} exists=${bin.exists()} canExec=${bin.canExecute()} len=${bin.length()}")

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
                val proc = pb.start()
                backendProcess = proc
                Log.i("puruLocal", "Local backend process started pid=? bin=${bin.absolutePath}")

                Thread {
                    try {
                        proc.inputStream.bufferedReader().useLines { lines ->
                            lines.forEach { Log.i("puruLocal-backend", it) }
                        }
                    } catch (e: Exception) {
                        Log.w("puruLocal", "backend output reader ended", e)
                    }
                }.start()

                Thread {
                    try {
                        val code = proc.waitFor()
                        Log.e("puruLocal", "Backend exited with code=$code")
                    } catch (e: Exception) {
                        Log.e("puruLocal", "Backend wait error", e)
                    }
                }.start()
            } catch (e: Exception) {
                Log.e("puruLocal", "Failed to start backend", e)
            }
        }.start()
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