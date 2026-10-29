/**
 * 独立网络代理：以前台服务承载 TLS 连接，USB 拔除后仍可接受已配对桌面端请求。
 */
package dev.androidautodesk.host

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.provider.Settings
import org.json.JSONObject
import java.security.SecureRandom
import java.util.Base64
import java.util.concurrent.Executors
import javax.net.ssl.SSLServerSocket
import javax.net.ssl.SSLSocket

class CompanionService : Service() {
    companion object {
        const val PORT = 39828 // 独立手机端服务端口，不依赖 adbd 的 5555 监听
        const val ACTION_PROJECTION = "dev.androidautodesk.host.PROJECTION"
        @Volatile var isRunning = false; private set
        @Volatile var hasProjection = false; internal set
    }

    private val workers = Executors.newCachedThreadPool()
    private var server: SSLServerSocket? = null
    private var wifiLock: WifiManager.WifiLock? = null
    private var cpuLock: PowerManager.WakeLock? = null
    private val token by lazy {
        val prefs = getSharedPreferences("companion", MODE_PRIVATE)
        prefs.getString("token", null) ?: ByteArray(32).also { SecureRandom().nextBytes(it) }
            .let { Base64.getUrlEncoder().withoutPadding().encodeToString(it) }
            .also { prefs.edit().putString("token", it).apply() }
    }

    override fun onCreate() {
        super.onCreate()
        val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(NotificationChannel("companion", "DroidStage 无线服务", NotificationManager.IMPORTANCE_LOW))
        val notification = Notification.Builder(this, "companion")
            .setContentTitle("DroidStage 无线服务运行中")
            .setContentText("保持手机与电脑在同一局域网")
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .build()
        startForeground(101, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        // 华为系统待机时可能让 Wi-Fi/CPU 休眠；服务运行期间保持可接受局域网请求。
        val wifi = getSystemService(WIFI_SERVICE) as WifiManager
        @Suppress("DEPRECATION")
        val lock = wifi.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "DroidStage:wireless")
        lock.setReferenceCounted(false)
        lock.acquire()
        wifiLock = lock
        val power = getSystemService(POWER_SERVICE) as PowerManager
        cpuLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "DroidStage:companion").apply {
            setReferenceCounted(false)
            acquire()
        }
        workers.execute { serve() }
    }

    /** 录屏授权只由可见界面提交，服务在获得授权后启动投屏能力。 */
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_PROJECTION) {
            val data = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra("projectionData", Intent::class.java)
                else @Suppress("DEPRECATION") intent.getParcelableExtra<Intent>("projectionData")
            if (data != null) {
                // Android 14+ 在获取投屏对象前要求前台服务标记 mediaProjection。
                val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
                val notification = Notification.Builder(this, "companion")
                    .setContentTitle("DroidStage 无线投屏已授权")
                    .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth).build()
                startForeground(101, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC or ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
                ProjectionEngine.start(this, intent.getIntExtra("resultCode", 0), data)
            }
        }
        return START_STICKY
    }

    private fun serve() {
        try {
            val socket = CompanionTls.context(this).serverSocketFactory.createServerSocket(PORT) as SSLServerSocket
            server = socket
            isRunning = true
            while (!socket.isClosed) {
                val client = socket.accept() as SSLSocket
                workers.execute { handle(client) }
            }
        } catch (error: Exception) {
            android.util.Log.e("DroidStage", "无线服务停止", error)
            isRunning = false
        }
    }

    private fun handle(socket: SSLSocket) {
        try { socket.use { client ->
            client.soTimeout = 65000
            val input = client.inputStream.bufferedReader(Charsets.UTF_8)
            val output = client.outputStream.bufferedWriter(Charsets.UTF_8)
            fun send(json: JSONObject) { synchronized(output) { output.write(json.toString()); output.newLine(); output.flush() } }
            while (true) {
                val line = try { input.readLine() } catch (_: java.net.SocketTimeoutException) { continue } ?: break
                if (line.length > 2_000_000) break
                val id = try { JSONObject(line).optInt("id", -1) } catch (_: Exception) { -1 }
                try {
                    val request = JSONObject(line)
                    val op = request.getString("op")
                    val result: Any = if (op == "pair") {
                        // USB 端口转发抵达手机时源地址为 loopback，局域网来客不得取走配对密钥。
                        if (!client.inetAddress.isLoopbackAddress) error("首次配对必须通过 USB")
                        JSONObject().put("token", token)
                            .put("deviceId", Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID))
                            .put("model", Build.MODEL).put("port", PORT)
                    } else {
                        if (request.optString("token") != token) error("无线会话验证失败")
                        when (op) {
                            "ping", "status" -> JSONObject()
                                .put("accessibility", CompanionAccessibility.current != null)
                                .put("projection", hasProjection)
                                .put("model", Build.MODEL)
                            else -> CompanionCommands.dispatch(this, op, request.optJSONObject("args") ?: JSONObject(), ::send)
                        }
                    }
                    send(JSONObject().put("id", id).put("ok", true).put("result", result))
                } catch (error: Exception) {
                    send(JSONObject().put("id", id).put("ok", false).put("error", error.message ?: "手机端操作失败"))
                }
            }
        } } catch (error: Exception) {
            android.util.Log.e("DroidStage", "TLS 客户端连接失败", error)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        isRunning = false
        server?.close()
        ProjectionEngine.stop()
        wifiLock?.takeIf { it.isHeld }?.release()
        cpuLock?.takeIf { it.isHeld }?.release()
        workers.shutdownNow()
        super.onDestroy()
    }
}
