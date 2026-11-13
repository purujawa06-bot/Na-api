package com.puruboy.purulocal_bot

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Environment
import android.os.IBinder
import android.util.Log
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.util.zip.ZipFile

class BackendService : Service() {
    companion object {
        const val CHANNEL_ID = "purulocal_backend"
        const val NOTIF_ID = 1001
        @Volatile var backendProcess: Process? = null
        @Volatile var starting = false
        @Volatile var instance: BackendService? = null

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

        fun restartBackend() {
            try {
                val svc = instance ?: return
                try { backendProcess?.destroy() } catch (_: Exception) {}
                backendProcess = null
                Thread {
                    try {
                        for (i in 0 until 10) {
                            try { Thread.sleep(300) } catch (_: Exception) {}
                            if (!svc.isPortInUse(8787)) break
                        }
                    } catch (_: Exception) {}
                    svc.startLocalBackend(force = true)
                }.start()
            } catch (e: Exception) {
                Log.e("puruLocal", "restartBackend failed", e)
            }
        }

        // === Runtime payload (launcher) helpers ===
        fun getRuntimeBaseDir(ctx: Context): File {
            val base = ctx.getExternalFilesDir(null) ?: ctx.filesDir
            return File(base, "purulocal-runtime")
        }

        fun getInstalledRuntimeVersion(ctx: Context): Int {
            return try {
                val f = File(getRuntimeBaseDir(ctx), "current/runtime.json")
                if (!f.exists()) return 0
                val j = JSONObject(f.readText())
                j.optInt("version", 0)
            } catch (_: Exception) { 0 }
        }

        fun getDeviceAbi(): String {
            return try {
                val abis = Build.SUPPORTED_ABIS
                if (abis != null && abis.isNotEmpty()) abis[0] else Build.CPU_ABI ?: "arm64-v8a"
            } catch (_: Exception) { "arm64-v8a" }
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
        createChannel()
        startForeground(NOTIF_ID, buildNotification("puruLocal Bot berjalan"))
        startLocalBackend()
    }

    override fun onDestroy() {
        instance = null
        super.onDestroy()
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

    private fun isValidBackendBinary(f: File?): Boolean {
        if (f == null) return false
        return try { f.exists() && f.isFile && f.length() > 1024 } catch (_: Exception) { false }
    }

    private fun prepareExecutableRuntimeCopy(src: File): File? {
        // Android/data (external app-specific) sering noexec, jadi salin ke lokasi executable internal
        val targets = listOf(
            File(codeCacheDir, "purulocal-runtime"),
            File(filesDir, "purulocal-runtime"),
            File(cacheDir, "purulocal-runtime"),
        )
        for (dir in targets) {
            try {
                dir.mkdirs()
                val dst = File(dir, "libpurulocal.so")
                val needCopy = !dst.exists() || dst.length() != src.length() || dst.lastModified() < src.lastModified()
                if (needCopy) {
                    src.inputStream().use { input -> FileOutputStream(dst).use { output -> input.copyTo(output) } }
                    Log.i("puruLocal", "Copied runtime payload to executable location: ${dst.absolutePath}")
                }
                ensureExecutable(dst)
                if (isValidBackendBinary(dst)) return dst
            } catch (e: Exception) {
                Log.w("puruLocal", "Failed to prepare runtime copy in ${dir.absolutePath}", e)
            }
        }
        return null
    }

    private fun findBackendBinary(): File? {
        // 1) Runtime payload terunduh (launcher): disimpan di Android/data/<pkg>/files/purulocal-runtime/current/
        //    (sesuai permintaan) namun dieksekusi dari salinan di lokasi internal yang executable.
        try {
            val runtimeCurrent = File(getRuntimeBaseDir(this), "current")
            val runtimeBin = File(runtimeCurrent, "libpurulocal.so")
            if (isValidBackendBinary(runtimeBin)) {
                val execBin = prepareExecutableRuntimeCopy(runtimeBin)
                if (execBin != null) {
                    Log.i("puruLocal", "Using runtime payload backend: src=${runtimeBin.absolutePath} exec=${execBin.absolutePath} len=${runtimeBin.length()}")
                    return execBin
                }
                Log.w("puruLocal", "Could not prepare executable copy of runtime payload, fallback to bundled")
            } else if (runtimeBin.exists()) {
                Log.w("puruLocal", "Runtime payload binary invalid, fallback to bundled: ${runtimeBin.absolutePath} len=${runtimeBin.length()}")
            }
        } catch (e: Exception) {
            Log.w("puruLocal", "Runtime payload lookup failed", e)
        }

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
        for (c in candidates) { try { if (isValidBackendBinary(c) && c.canExecute()) return c } catch (_: Exception) {} }
        for (c in candidates) { try { if (isValidBackendBinary(c)) { ensureExecutable(c); return c } } catch (_: Exception) {} }
        try {
            val extracted = extractBackendFromApk()
            if (isValidBackendBinary(extracted)) return extracted
        } catch (e: Exception) { Log.e("puruLocal", "Failed to extract backend from APK", e) }
        Log.e("puruLocal", "Backend binary not found. nativeLibraryDir=$nativeDir candidates=${candidates.map { it.absolutePath }}")
        return null
    }

    private fun ensureExecutable(f: File) {
        try { f.setReadable(true, true); f.setExecutable(true, false) } catch (_: Exception) {}
        try { Runtime.getRuntime().exec(arrayOf("chmod", "755", f.absolutePath)).waitFor() } catch (_: Exception) {}
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
                        ensureExecutable(outFile)
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

    private fun startLocalBackend(force: Boolean = false) {
        if (starting) return
        synchronized(this) {
            if (starting) return
            starting = true
        }
        Thread {
            try {
                if (!force && isPortInUse(8787)) {
                    Log.i("puruLocal", "Backend port 8787 already in use, skipping start")
                    return@Thread
                }
                Log.i("puruLocal", "Starting local backend. nativeLibraryDir=${applicationInfo.nativeLibraryDir} sourceDir=${applicationInfo.sourceDir} abi=${Build.SUPPORTED_ABIS?.joinToString()}")
                val bin = findBackendBinary() ?: run { Log.e("puruLocal", "No backend binary available"); return@Thread }
                ensureExecutable(bin)
                Log.i("puruLocal", "Using backend binary: ${bin.absolutePath} exists=${bin.exists()} canExec=${bin.canExecute()} len=${bin.length()}")

                // Sesi/data tetap di folder persisten (puruLocalBot) seperti sebelumnya
                val dataDir = getPersistentDataDir(this)
                if (!dataDir.exists()) dataDir.mkdirs()
                migrateLegacyDataIfNeeded(dataDir)
                val cfg = File(dataDir, "config.json").absolutePath
                val storeDir = File(dataDir, "data")
                if (!storeDir.exists()) storeDir.mkdirs()
                Log.i("puruLocal", "Using data dir: ${dataDir.absolutePath} (writable=${ensureWritableDir(dataDir)})")

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

    private fun getPersistentDataDir(ctx: Context): File {
        // Simpan di penyimpanan bersama agar sesi tetap aman saat APK dihapus (Android 10/legacy)
        val fallback = File(ctx.filesDir, "purulocal")
        return try {
            val ext = Environment.getExternalStorageDirectory()
            val dir = File(ext, "puruLocalBot")
            if (ensureWritableDir(dir)) {
                Log.i("puruLocal", "Persistent external dir available: ${dir.absolutePath}")
                dir
            } else {
                Log.w("puruLocal", "External dir not writable, using app-private dir: ${fallback.absolutePath}")
                fallback
            }
        } catch (e: Exception) {
            Log.w("puruLocal", "Falling back to app-private data dir", e)
            fallback
        }
    }

    private fun ensureWritableDir(dir: File): Boolean {
        return try {
            if (!dir.exists() && !dir.mkdirs()) return false
            if (!dir.canWrite()) return false
            val probe = File(dir, ".probe")
            probe.writeText("ok")
            val ok = probe.exists()
            try { probe.delete() } catch (_: Exception) {}
            ok
        } catch (_: Exception) {
            false
        }
    }

    private fun migrateLegacyDataIfNeeded(target: File) {
        try {
            val legacy = File(filesDir, "purulocal")
            if (!legacy.exists() || legacy.absolutePath == target.absolutePath) return
            val marker = File(target, ".migrated")
            if (marker.exists()) return
            // copy basic files/dirs if missing in target
            copyIfMissing(File(legacy, "config.json"), File(target, "config.json"))
            copyDirIfMissing(File(legacy, "data"), File(target, "data"))
            marker.writeText("ok")
            Log.i("puruLocal", "Migrated legacy data from ${legacy.absolutePath} to ${target.absolutePath}")
        } catch (e: Exception) {
            Log.w("puruLocal", "Legacy data migration failed", e)
        }
    }

    private fun copyIfMissing(src: File, dst: File) {
        try {
            if (!src.exists() || dst.exists()) return
            dst.parentFile?.mkdirs()
            src.copyTo(dst, overwrite = false)
        } catch (_: Exception) {}
    }

    private fun copyDirIfMissing(src: File, dst: File) {
        try {
            if (!src.exists() || !src.isDirectory) return
            if (!dst.exists()) {
                src.copyRecursively(dst, overwrite = false)
                return
            }
            src.listFiles()?.forEach { f ->
                val d = File(dst, f.name)
                if (f.isDirectory) copyDirIfMissing(f, d) else copyIfMissing(f, d)
            }
        } catch (_: Exception) {}
    }
}
