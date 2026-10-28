/**
 * 手机端自动化代理：通过本地 socket 执行控件查询、输入与设备操作。
 */
package dev.androidautodesk.host

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.Configurator
import androidx.test.uiautomator.UiDevice
import org.json.JSONObject
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayOutputStream
import java.io.PrintWriter
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

@RunWith(AndroidJUnit4::class)
class AgentTest {
    private companion object {
        // 视频类 App 持续发出无障碍事件，等待长时间空闲会耗尽用户设置的控件查找超时。
        const val UI_IDLE_WAIT_MS = 100L
        const val COUNT_POLL_INTERVAL_MS = 100L // 短轮询只用于消除页面切换时控件树尚未刷新的瞬态空结果
    }

    private val device by lazy { UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()) }
    private val locator by lazy { ElementLocator(device) }
    private val inputs by lazy { InputOperations(locator) }
    private val lists by lazy { ListOperations(locator) }
    private val stateRows by lazy { RowStateOperations(locator) }
    // 触摸/滚轮注入独立于 UiDevice 高层 API，见 TouchInjector 注释
    private val injector by lazy { TouchInjector(InstrumentationRegistry.getInstrumentation().uiAutomation) }
    private val token by lazy { InstrumentationRegistry.getArguments().getString("token") ?: error("缺少会话密钥") }
    private val running = AtomicBoolean(true)

    @Test
    fun serve() {
        Configurator.getInstance().setWaitForIdleTimeout(UI_IDLE_WAIT_MS)
        val connections: ExecutorService = Executors.newCachedThreadPool()
        ServerSocket(39827, 4, InetAddress.getByName("127.0.0.1")).use { server ->
            server.soTimeout = 2000
            while (running.get()) {
                try {
                    val socket = server.accept()
                    // 每连接一线程：投屏的触摸通道与命令通道分离，避免触摸被 wait/snapshot 等长操作阻塞
                    connections.execute { handleConnection(socket) }
                } catch (_: java.net.SocketTimeoutException) { /* 轮询 shutdown 标志 */ }
            }
        }
        connections.shutdownNow()
    }

    /** 单连接处理循环：逐行读取请求并同步应答，直到连接断开或服务关闭。 */
    private fun handleConnection(socket: Socket) {
        socket.use {
            it.soTimeout = 65000
            val input = it.getInputStream().bufferedReader(Charsets.UTF_8)
            val output = PrintWriter(it.getOutputStream().bufferedWriter(Charsets.UTF_8), true)
            while (running.get()) {
                val line = try { input.readLine() } catch (_: java.net.SocketTimeoutException) { continue } ?: break
                output.println(respond(line).toString())
            }
        }
    }

    /** 解析并执行单条请求；任何异常都折成带原始 id 的错误响应，保证连接存活。 */
    private fun respond(line: String): JSONObject {
        return try {
            val request = JSONObject(line)
            if (request.optString("token") != token) error("会话验证失败")
            val result = dispatch(request.getString("op"), request.optJSONObject("args") ?: JSONObject())
            JSONObject().put("id", request.getInt("id")).put("ok", true).put("result", result)
        } catch (error: Exception) {
            val id = try { JSONObject(line).optInt("id", -1) } catch (_: Exception) { -1 }
            JSONObject().put("id", id).put("ok", false).put("error", error.message ?: error.javaClass.simpleName)
        }
    }

    private fun dispatch(op: String, args: JSONObject): Any {
        return when (op) {
            "ping" -> "pong"
            "shutdown" -> { running.set(false); "ok" }
            "touch" -> injector.touch(args)
            "scroll" -> injector.scroll(args)
            "snapshot" -> ByteArrayOutputStream().use { out ->
                device.dumpWindowHierarchy(out)
                out.toString("UTF-8")
            }
            "count" -> countMatches(args.getJSONObject("selector"), args.optLong("waitMs", 0L))
            "inspectMatches" -> locator.inspect(args.getJSONObject("selector"))
            "scanRows" -> if (args.optString("mode") == "rowState") stateRows.scan(args) else lists.scan(args)
            "tapRow" -> if (args.optString("mode") == "rowState") stateRows.tap(args) else lists.tap(args)
            "scrollList" -> lists.scroll(args)
            "tap" -> {
                if (args.has("selector") && !args.isNull("selector")) {
                    locator.findUnique(args.getJSONObject("selector"), args.optLong("timeoutMs", 10000)).click()
                } else {
                    val point = args.getJSONObject("point")
                    if (!device.click(point.getInt("x"), point.getInt("y"))) error("坐标点击失败")
                }
                "ok"
            }
            "input" -> {
                inputs.input(args.getJSONObject("selector"), args.getString("text"), args.optLong("timeoutMs", 10000))
                "ok"
            }
            "swipe" -> {
                val from = args.getJSONObject("from")
                val to = args.getJSONObject("to")
                val duration = args.getInt("durationMs")
                if (!device.swipe(from.getInt("x"), from.getInt("y"), to.getInt("x"), to.getInt("y"), (duration / 5).coerceAtLeast(1))) error("滑动失败")
                "ok"
            }
            "wait" -> {
                val selector = args.getJSONObject("selector")
                val wantExists = args.getBoolean("exists")
                val deadline = System.currentTimeMillis() + args.getLong("timeoutMs")
                while (true) {
                    val count = locator.count(selector)
                    if (count > 1) error("定位条件匹配多个控件")
                    if ((count == 1) == wantExists) break
                    if (System.currentTimeMillis() >= deadline) error("等待控件超时")
                    Thread.sleep(200)
                }
                "ok"
            }
            "key" -> {
                val success = when (args.getString("key")) {
                    "back" -> device.pressBack()
                    "home" -> device.pressHome()
                    else -> error("未知按键")
                }
                if (!success) error("按键失败")
                "ok"
            }
            else -> error("未知操作：$op")
        }
    }

    /**
     * 查询控件数量；等待期内只重试空结果，发现匹配或超过期限后立即返回。
     * @param selector 任务定位条件
     * @param waitMs 空结果的最长等待时间，范围为 0–60000 毫秒
     * @return 最终匹配数量
     */
    private fun countMatches(selector: JSONObject, waitMs: Long): Int {
        if (waitMs !in 0L..60000L) error("控件查询等待时间无效")
        val deadline = System.currentTimeMillis() + waitMs
        while (true) {
            val count = locator.count(selector)
            val now = System.currentTimeMillis()
            if (count != 0 || now >= deadline) return count
            Thread.sleep(minOf(COUNT_POLL_INTERVAL_MS, deadline - now))
        }
    }

}
