package com.puruboy.purulocal_bot

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.util.Log
import java.io.File
import java.io.FileOutputStream
import java.util.zip.ZipFile

class BackendService : Service() {
    companion object {
        const val CHANNEL_ID = "purulocal_backend"
        const val NOTIF_ID = 1001
        @Volatile var backendProcess: Process? = null
        @Volatile var starting = false

        fun ensureStarted(ctx: Context) {
            val i = Intent(ctx, BackendService::class.java)
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    ctx.startForegroundService(i)
                } else {
                    ctx.startService(i)
                }
            } catch (e: Exception) {
                Log.e("puruLocal", "Failed to start BackendService", e)
                try { ctx.startService(i) } catch (_: Exception) {}
            }
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createChannel()
        startForeground(NOTIF_ID, buildNotification("puruLocal Bot berjalan"))
        startLocalBackend()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (backendProcess == null || backendProcess?.isAlive != true) {
            startLocalBackend()
        }
        return START_STICKY
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val mgr = getSystemService(NotificationManager::class.java)
            val ch = NotificationChannel(CHANNEL_ID, "puruLocal Bot", NotificationManager.IMPORTANCE_LOW)
            ch.description = "Menjaga bot berjalan di latar belakang"
            mgr.createNotificationChannel(ch)
        }
    }

    private fun buildNotification(text: String): Notification {
        val pi = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0)
        )
        val b = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION") Notification.Builder(this)
        }
        return b.setContentTitle("puruLocal Bot")
            .setContentText(text)
            .setSmallIcon(applicationInfo.icon)
            .setContentIntent(pi)
            .setOngoing(true)
            .build()
    }

    private fun isPortInUse(port: Int): Boolean {
        return try { java.net.Socket("127.0.0.1", port).use { true } } catch (_: Exception) { false }
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
            parent.listFiles()?.forEach { dir -> if (dir.isDirectory) candidates.add(File(dir, "libpurulocal.so")) }
        }
        candidates.add(File("/data/data/$packageName/lib/libpurulocal.so"))
        for (c in candidates) { try { if (c.exists() && c.canExecute()) return c } catch (_: Exception) {} }
        for (c in candidates) { try { if (c.exists()) return c } catch (_: Exception) {} }
        try {
            val extracted = extractBackendFromApk()
            if (extracted != null && extracted.exists()) return extracted
        } catch (e: Exception) { Log.e("puruLocal", "Failed to extract backend from APK", e) }
        Log.e("puruLocal", "Backend binary not found. nativeLibraryDir=$nativeDir candidates=${candidates.map { it.absolutePath }}")
        return null
    }

    private fun extractBackendFromApk(): File? {
        val dirs = listOf(File(codeCacheDir, "purulocal"), File(filesDir, "purulocal/bin"), File(cacheDir, "purulocal"))
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
            } catch (e: Exception) { Log.e("puruLocal", "Extract failed for dir ${outDir.absolutePath}", e) }
        }
        Log.e("puruLocal", "extractBackendFromApk: no libpurulocal.so found in APK $apkPath for abis=$abis")
        return null
    }

    private fun buildStartCommand(bin: File): List<String> {
        val path = bin.absolutePath
        if (path.contains("/lib/") && bin.canExecute()) return listOf(path)
        val linker64 = File("/system/bin/linker64")
        val linker = File("/system/bin/linker")
        return when {
            linker64.exists() -> listOf(linker64.absolutePath, path)
            linker.exists() -> listOf(linker.absolutePath, path)
            else -> listOf(path)
        }
    }

    private fun startLocalBackend() {
        if (starting) return
        synchronized(this) {
            if (starting) return
            starting = true
        }
        Thread {
            try {
                if (isPortInUse(8787)) {
                    Log.i("puruLocal", "Backend port 8787 already in use, skipping start")
                    return@Thread
                }
                Log.i("puruLocal", "Starting local backend. nativeLibraryDir=${applicationInfo.nativeLibraryDir} sourceDir=${applicationInfo.sourceDir} abi=${Build.SUPPORTED_ABIS?.joinToString()}")
                val bin = findBackendBinary() ?: run { Log.e("puruLocal", "No backend binary available"); return@Thread }
                try { bin.setReadable(true, true); bin.setExecutable(true, false) } catch (_: Exception) {}
                try { Runtime.getRuntime().exec(arrayOf("chmod", "755", bin.absolutePath)).waitFor() } catch (_: Exception) {}
                Log.i("puruLocal", "Using backend binary: ${bin.absolutePath} exists=${bin.exists()} canExec=${bin.canExecute()} len=${bin.length()}")

                val dataDir = File(filesDir, "purulocal")
                dataDir.mkdirs()
                val cfg = File(dataDir, "config.json").absolutePath
                val storeDir = File(dataDir, "data")
                storeDir.mkdirs()

                val cmd = buildStartCommand(bin)
                Log.i("puruLocal", "Starting backend cmd=${cmd.joinToString(" ")}")
                val pb = ProcessBuilder(cmd)
                pb.redirectErrorStream(true)
                val env = pb.environment()
                env["PURULOCAL_ADDR"] = "127.0.0.1:8787"
                env["PURULOCAL_CONFIG"] = cfg
                env["PURULOCAL_DATA"] = storeDir.absolutePath
                pb.directory(dataDir)
                val proc = pb.start()
                backendProcess = proc
                Log.i("puruLocal", "Local backend process started bin=${bin.absolutePath}")

                Thread {
                    try { proc.inputStream.bufferedReader().useLines { lines -> lines.forEach { Log.i("puruLocal-backend", it) } } }
                    catch (e: Exception) { Log.w("puruLocal", "backend output reader ended", e) }
                }.start()
                Thread {
                    try {
                        val code = proc.waitFor()
                        Log.e("puruLocal", "Backend exited with code=$code")
                        backendProcess = null
                        // auto-restart after delay if service still alive
                        Thread.sleep(2000)
                        if (!isPortInUse(8787)) startLocalBackend()
                    } catch (e: Exception) { Log.e("puruLocal", "Backend wait error", e) }
                }.start()
            } catch (e: Exception) {
                Log.e("puruLocal", "Failed to start backend", e)
            } finally {
                starting = false
            }
        }.start()
    }
}