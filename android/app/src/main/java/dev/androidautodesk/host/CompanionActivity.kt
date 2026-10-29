/**
 * 手机端直连入口：由用户启动服务并授予无障碍、录屏权限。
 */
package dev.androidautodesk.host

import android.app.Activity
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.Bundle
import android.provider.Settings
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import java.net.NetworkInterface

class CompanionActivity : Activity() {
    private lateinit var status: TextView
    private val projectionRequest = 1001

    /** 创建明确的权限入口，避免后台静默申请敏感能力。 */
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 48, 32, 32)
        }
        status = TextView(this).apply { textSize = 18f }
        layout.addView(status)
        fun button(label: String, action: () -> Unit) {
            layout.addView(Button(this).apply { text = label; setOnClickListener { action() } })
        }
        button("开启无障碍服务") { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }
        button("启动无线服务") {
            startForegroundService(Intent(this, CompanionService::class.java))
            updateStatus()
        }
        button("停止无线服务") {
            stopService(Intent(this, CompanionService::class.java))
            updateStatus()
        }
        button("允许录屏和投屏") {
            val manager = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            startActivityForResult(manager.createScreenCaptureIntent(), projectionRequest)
        }
        button("刷新状态") { updateStatus() }
        setContentView(layout)
        updateStatus()
    }

    /** 将用户确认后的录屏授权交给正在前台运行的服务。 */
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == projectionRequest && resultCode == RESULT_OK && data != null) {
            startForegroundService(Intent(this, CompanionService::class.java).apply {
                action = CompanionService.ACTION_PROJECTION
                putExtra("resultCode", resultCode)
                putExtra("projectionData", data)
            })
        }
        updateStatus()
    }

    override fun onResume() { super.onResume(); updateStatus() }

    private fun updateStatus() {
        val wifiIp = try {
            NetworkInterface.getByName("wlan0")?.inetAddresses?.asSequence()
                ?.firstOrNull { it is java.net.Inet4Address && !it.isLoopbackAddress }?.hostAddress
        } catch (_: Exception) { null }
        status.text = "无障碍：${if (CompanionAccessibility.current != null) "已授权" else "未授权"}\n" +
            "无线服务：${if (CompanionService.isRunning) "已启动" else "未启动"}\n" +
            "录屏：${if (CompanionService.hasProjection) "已授权" else "未授权"}\n" +
            "当前 Wi-Fi IP：${wifiIp ?: "未连接"}\n" +
            "端口：${CompanionService.PORT}（手机与电脑需在同一局域网）"
    }
}
