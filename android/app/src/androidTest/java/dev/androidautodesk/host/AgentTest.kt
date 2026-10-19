package dev.androidautodesk.host

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.BySelector
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
    private val device by lazy { UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()) }
    // 触摸/滚轮注入独立于 UiDevice 高层 API，见 TouchInjector 注释
    private val injector by lazy { TouchInjector(InstrumentationRegistry.getInstrumentation().uiAutomation) }
    private val token by lazy { InstrumentationRegistry.getArguments().getString("token") ?: error("缺少会话密钥") }
    private val running = AtomicBoolean(true)

    @Test
    fun serve() {
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
            "count" -> matches(selector(args.getJSONObject("selector"))).size
            "tap" -> {
                if (args.has("selector") && !args.isNull("selector")) {
                    findUnique(selector(args.getJSONObject("selector")), args.optLong("timeoutMs", 10000)).click()
                } else {
                    val point = args.getJSONObject("point")
                    if (!device.click(point.getInt("x"), point.getInt("y"))) error("坐标点击失败")
                }
                "ok"
            }
            "input" -> {
                val target = findUnique(selector(args.getJSONObject("selector")), args.optLong("timeoutMs", 10000))
                target.setText(args.getString("text"))
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
                val by = selector(args.getJSONObject("selector"))
                val wantExists = args.getBoolean("exists")
                val deadline = System.currentTimeMillis() + args.getLong("timeoutMs")
                while (true) {
                    val count = matches(by).size
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

    private fun selector(json: JSONObject): BySelector {
        val value = json.getString("value")
        if (value.isBlank()) error("定位值不能为空")
        return when (json.getString("kind")) {
            "resourceId" -> By.res(value)
            "description" -> By.desc(value)
            "text" -> By.text(value)
            "className" -> By.clazz(value)
            else -> error("未知定位方式")
        }
    }

    private fun matches(by: BySelector) = device.findObjects(by)

    private fun findUnique(by: BySelector, timeoutMs: Long): androidx.test.uiautomator.UiObject2 {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (true) {
            val found = matches(by)
            if (found.size > 1) error("定位条件匹配多个控件")
            if (found.size == 1) return found[0]
            if (System.currentTimeMillis() >= deadline) error("未找到控件")
            Thread.sleep(200)
        }
    }
}
