/**
 * 手机端直连命令：复用任务协议名称，按授权状态调用无障碍与录屏能力。
 */
package dev.androidautodesk.host

import android.content.Context
import android.content.Intent
import android.util.Base64
import org.json.JSONObject

internal object CompanionCommands {
    /** 返回结果或抛出明确错误，避免桌面端把缺失权限误判为成功。 */
    fun dispatch(context: Context, op: String, args: JSONObject, send: (JSONObject) -> Unit): Any {
        return when (op) {
            "snapshot" -> AccessibilityBridge.snapshot()
            "count" -> {
                val selector = args.getJSONObject("selector")
                val waitMs = args.optLong("waitMs", 0).coerceIn(0, 60000)
                val deadline = System.currentTimeMillis() + waitMs
                var count: Int
                do {
                    count = AccessibilityBridge.count(selector)
                    if (count != 0 || System.currentTimeMillis() >= deadline) break
                    Thread.sleep(100)
                } while (true)
                count
            }
            "inspectMatches" -> AccessibilityBridge.inspect(args.getJSONObject("selector"))
            "tap" -> {
                val selector = args.optJSONObject("selector")
                if (selector != null) AccessibilityBridge.tap(AccessibilityBridge.findUnique(selector, args.optLong("timeoutMs", 10000)))
                else {
                    val point = args.getJSONObject("point")
                    val x = point.getDouble("x").toFloat()
                    val y = point.getDouble("y").toFloat()
                    AccessibilityBridge.gesture(x, y, x, y, 70)
                }
                "ok"
            }
            "input" -> {
                AccessibilityBridge.input(AccessibilityBridge.findUnique(args.getJSONObject("selector"), args.optLong("timeoutMs", 10000)), args.getString("text"))
                "ok"
            }
            "swipe" -> {
                val from = args.getJSONObject("from")
                val to = args.getJSONObject("to")
                AccessibilityBridge.gesture(from.getDouble("x").toFloat(), from.getDouble("y").toFloat(),
                    to.getDouble("x").toFloat(), to.getDouble("y").toFloat(), args.getLong("durationMs"))
                "ok"
            }
            "wait" -> {
                val deadline = System.currentTimeMillis() + args.getLong("timeoutMs")
                val wanted = args.getBoolean("exists")
                val selector = args.getJSONObject("selector")
                while (true) {
                    val count = AccessibilityBridge.count(selector)
                    if (count > 1) error("定位条件匹配多个控件")
                    if ((count == 1) == wanted) break
                    if (System.currentTimeMillis() >= deadline) error("等待控件超时")
                    Thread.sleep(200)
                }
                "ok"
            }
            "key" -> { AccessibilityBridge.key(args.getString("key")); "ok" }
            "launch" -> {
                val packageName = args.getString("packageName")
                val intent = context.packageManager.getLaunchIntentForPackage(packageName)
                    ?: error("无法启动 App：$packageName，请确认手机已安装")
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(intent)
                "ok"
            }
            "screenshot" -> Base64.encodeToString(ProjectionEngine.screenshot(context), Base64.NO_WRAP)
            "mirrorStart" -> ProjectionEngine.startMirror(context, args.optInt("maxSize", 1024),
                args.optInt("bitRate", 6000000), args.optInt("fps", 60), send)
            "mirrorStop" -> { ProjectionEngine.stopMirror(); "ok" }
            "scrollList" -> AccessibilityBridge.scroll(args.getJSONObject("container"))
            "scanRows" -> if (args.optString("mode") == "rowState") CompanionRowState.scan(args) else CompanionList.scan(args)
            "tapRow" -> if (args.optString("mode") == "rowState") CompanionRowState.tap(args) else CompanionList.tap(args)
            else -> error("未知操作：$op")
        }
    }
}
