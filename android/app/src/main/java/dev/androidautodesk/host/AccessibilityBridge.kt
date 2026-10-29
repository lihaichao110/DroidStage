/**
 * 无障碍界面操作：将现有定位条件映射为控件树查询、动作和层级快照。
 */
package dev.androidautodesk.host

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.graphics.Rect
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONArray
import org.json.JSONObject
import java.io.StringWriter
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import android.util.Xml

internal object AccessibilityBridge {
    private fun service(): CompanionAccessibility = CompanionAccessibility.current ?: error("请先在手机上启用 DroidStage 无障碍服务")
    private fun root(): AccessibilityNodeInfo = service().rootInActiveWindow ?: error("无法读取当前屏幕控件，请解锁手机并检查无障碍权限")

    /** 查询当前屏幕精确匹配的节点；排序与 USB 会话的视觉顺序一致。 */
    fun matches(selector: JSONObject, scope: AccessibilityNodeInfo? = null): List<AccessibilityNodeInfo> {
        val kind = selector.getString("kind")
        val value = selector.getString("value")
        if (value.isBlank()) error("定位值不能为空")
        val found = mutableListOf<AccessibilityNodeInfo>()
        fun visit(node: AccessibilityNodeInfo) {
            val actual = when (kind) {
                "resourceId" -> node.viewIdResourceName
                "description" -> node.contentDescription?.toString()
                "text" -> node.text?.toString()
                "className" -> node.className?.toString()
                else -> error("未知定位方式")
            }
            if (actual == value) found.add(node)
            for (index in 0 until node.childCount) node.getChild(index)?.let(::visit)
        }
        visit(scope ?: root())
        return found.sortedWith(compareBy<AccessibilityNodeInfo> { bounds(it).top }
            .thenBy { bounds(it).left }.thenBy { bounds(it).bottom }.thenBy { bounds(it).right })
    }

    /** 保持显式匹配序号语义；目标不够或位置重叠时不猜测其他节点。 */
    fun count(selector: JSONObject): Int {
        val found = matches(selector)
        val index = selector.optInt("matchIndex", 0)
        if (index == 0) return found.size
        if (index !in 1..10000) error("匹配序号无效")
        if (found.size < index) error("匹配控件不足 $index 个")
        val selected = bounds(found[index - 1])
        if (found.indices.any { it != index - 1 && bounds(found[it]) == selected }) error("匹配控件位置无法区分")
        return 1
    }

    /** 给编辑器返回可视候选边界。 */
    fun inspect(selector: JSONObject): JSONArray = JSONArray().also { result ->
        matches(selector).forEachIndexed { offset, node ->
            result.put(JSONObject().put("index", offset + 1).put("bounds", boundsJson(bounds(node))))
        }
    }

    fun findUnique(selector: JSONObject, timeoutMs: Long): AccessibilityNodeInfo {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (true) {
            val found = matches(selector)
            val index = selector.optInt("matchIndex", 0)
            if (index == 0 && found.size > 1) error("定位条件匹配多个控件")
            if (index > 0 && found.size >= index) {
                if (found.indices.any { it != index - 1 && bounds(found[it]) == bounds(found[index - 1]) }) error("匹配控件位置无法区分")
                return found[index - 1]
            }
            if (index == 0 && found.size == 1) return found[0]
            if (System.currentTimeMillis() >= deadline) error(if (index == 0) "未找到控件" else "匹配控件不足 $index 个")
            Thread.sleep(200)
        }
    }

    fun tap(node: AccessibilityNodeInfo) {
        var target: AccessibilityNodeInfo? = node
        while (target != null) {
            if (target.isClickable && target.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return
            target = target.parent
        }
        val rect = bounds(node)
        if (rect.isEmpty) error("控件没有可点击边界")
        gesture((rect.left + rect.right) / 2f, (rect.top + rect.bottom) / 2f,
            (rect.left + rect.right) / 2f, (rect.top + rect.bottom) / 2f, 70)
    }

    fun input(node: AccessibilityNodeInfo, text: String) {
        val args = Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text) }
        if (!node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) error("控件不支持文本输入")
    }

    /** 在目标屏幕坐标发送手势，等待系统确认动作完成。 */
    fun gesture(x1: Float, y1: Float, x2: Float, y2: Float, durationMs: Long) {
        val path = Path().apply { moveTo(x1, y1); if (x1 != x2 || y1 != y2) lineTo(x2, y2) }
        val stroke = GestureDescription.StrokeDescription(path, 0, durationMs.coerceIn(1, 60000))
        val latch = CountDownLatch(1)
        var completed = false
        val callback = object : AccessibilityService.GestureResultCallback() {
            override fun onCompleted(gestureDescription: GestureDescription?) { completed = true; latch.countDown() }
            override fun onCancelled(gestureDescription: GestureDescription?) { latch.countDown() }
        }
        if (!service().dispatchGesture(GestureDescription.Builder().addStroke(stroke).build(), callback, Handler(Looper.getMainLooper()))) {
            error("系统拒绝手势操作")
        }
        if (!latch.await(durationMs + 3000, TimeUnit.MILLISECONDS) || !completed) error("手势操作未完成")
    }

    fun key(key: String) {
        val action = when (key) {
            "back" -> AccessibilityService.GLOBAL_ACTION_BACK
            "home" -> AccessibilityService.GLOBAL_ACTION_HOME
            else -> error("未知按键")
        }
        if (!service().performGlobalAction(action)) error("系统拒绝按键操作")
    }

    fun scroll(selector: JSONObject): Boolean {
        val node = findUnique(selector, 3000)
        if (!node.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)) return false
        Thread.sleep(250)
        return true
    }

    fun bounds(node: AccessibilityNodeInfo): Rect = Rect().also(node::getBoundsInScreen)
    fun boundsJson(rect: Rect): JSONObject = JSONObject().put("left", rect.left).put("top", rect.top)
        .put("right", rect.right).put("bottom", rect.bottom)

    /** 输出与 USB 代理相同的 uiautomator 风格 XML，供桌面端现有解析器复用。 */
    fun snapshot(): String {
        val writer = StringWriter()
        val xml = Xml.newSerializer().apply { setOutput(writer); startDocument("UTF-8", true); startTag(null, "hierarchy") }
        var remaining = 10000
        fun visit(node: AccessibilityNodeInfo, index: Int) {
            if (remaining-- <= 0) return
            val rect = bounds(node)
            xml.startTag(null, "node")
            xml.attribute(null, "index", index.toString())
            xml.attribute(null, "text", node.text?.toString() ?: "")
            xml.attribute(null, "resource-id", node.viewIdResourceName ?: "")
            xml.attribute(null, "content-desc", node.contentDescription?.toString() ?: "")
            xml.attribute(null, "class", node.className?.toString() ?: "")
            xml.attribute(null, "package", node.packageName?.toString() ?: "")
            xml.attribute(null, "clickable", node.isClickable.toString())
            xml.attribute(null, "scrollable", node.isScrollable.toString())
            xml.attribute(null, "bounds", "[${rect.left},${rect.top}][${rect.right},${rect.bottom}]")
            for (child in 0 until node.childCount) node.getChild(child)?.let { visit(it, child) }
            xml.endTag(null, "node")
        }
        visit(root(), 0)
        xml.endTag(null, "hierarchy")
        xml.endDocument()
        return writer.toString()
    }
}
