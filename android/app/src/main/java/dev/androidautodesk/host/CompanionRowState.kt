/**
 * 无身份列表操作：按固定层级、可见边界和状态按钮重查，避免盲点已滚动的行。
 */
package dev.androidautodesk.host

import android.graphics.Rect
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONArray
import org.json.JSONObject

internal object CompanionRowState {
    /** 返回每行状态及边界，供桌面端做跨屏去重与异常提示。 */
    fun scan(args: JSONObject): JSONArray {
        val container = AccessibilityBridge.findUnique(args.getJSONObject("container"), 0)
        val rows = rows(container, args)
        val fullHeight = rows.maxOfOrNull { AccessibilityBridge.bounds(it).height() } ?: 0
        val containerBounds = AccessibilityBridge.bounds(container)
        val duplicates = rows.groupingBy { AccessibilityBridge.bounds(it).toShortString() }
            .eachCount()
        return JSONArray().also { result ->
            rows.forEachIndexed { offset, row ->
                val bounds = AccessibilityBridge.bounds(row)
                val pending = children(row, args.getJSONObject("action")).size
                val completed = children(row, args.getJSONObject("completed")).size
                val partial = fullHeight > 0 && bounds.height() * 2 < fullHeight
                val topPartial = partial && bounds.top <= containerBounds.top
                val deferred = partial && !topPartial && bounds.bottom >= containerBounds.bottom
                val reason = when {
                    bounds.isEmpty -> "用户行没有可见边界"
                    duplicates[bounds.toShortString()] != 1 -> "多条用户行边界重合"
                    pending > 1 -> "行内待点击控件不唯一"
                    completed > 1 -> "行内完成状态控件不唯一"
                    pending > 0 && completed > 0 -> "待点击与完成状态同时存在"
                    topPartial && pending == 0 && completed == 0 ->
                        "用户行顶部不完整且状态不可见，请将该行滚动到完整可见后重试"
                    pending == 0 && completed == 0 -> "未识别关注或已关注状态"
                    else -> null
                }
                val status = when {
                    reason != null && pending == 0 && completed == 0 -> "missing"
                    reason != null -> "ambiguous"
                    pending == 1 -> "pending"
                    else -> "completed"
                }
                result.put(JSONObject().put("index", offset + 1).put("bounds", AccessibilityBridge.boundsJson(bounds))
                    .put("status", status).put("deferred", deferred).put("error", reason))
            }
        }
    }

    /** 点击前校验序号与原边界；点击后无法确认时交给桌面端全屏复核。 */
    fun tap(args: JSONObject): JSONObject {
        val index = args.getInt("index")
        val expected = args.getJSONObject("bounds")
        val row = currentRow(args, index, expected) ?: return failure("点击前控件树已刷新，跳过该行")
        val action = children(row, args.getJSONObject("action"))
        val completed = children(row, args.getJSONObject("completed"))
        if (action.size != 1 || completed.isNotEmpty()) return failure("点击前关注状态已变化")
        try { AccessibilityBridge.tap(action[0]) }
        catch (error: Exception) { return failure("点击失败：${error.message}") }
        val deadline = System.currentTimeMillis() + args.optLong("timeoutMs", 10000)
        while (true) {
            val current = currentRow(args, index, expected)
                ?: return JSONObject().put("ok", true).put("confirmed", false).put("reason", "点击后用户行位置已变化")
            val done = children(current, args.getJSONObject("completed"))
            val pending = children(current, args.getJSONObject("action"))
            if (done.size == 1 && pending.isEmpty()) return JSONObject().put("ok", true).put("confirmed", true)
            if (System.currentTimeMillis() >= deadline)
                return JSONObject().put("ok", true).put("confirmed", false).put("reason", "点击后原行未出现已关注状态")
            Thread.sleep(200)
        }
    }

    private fun currentRow(args: JSONObject, index: Int, expected: JSONObject): AccessibilityNodeInfo? {
        val container = AccessibilityBridge.findUnique(args.getJSONObject("container"), 0)
        val row = rows(container, args).getOrNull(index - 1) ?: return null
        val bounds = AccessibilityBridge.bounds(row)
        return row.takeIf { bounds.left == expected.getInt("left") && bounds.top == expected.getInt("top") &&
            bounds.right == expected.getInt("right") && bounds.bottom == expected.getInt("bottom") }
    }

    private fun rows(container: AccessibilityNodeInfo, args: JSONObject): List<AccessibilityNodeInfo> {
        val depth = args.getInt("rowDepth")
        if (depth !in 1..20) error("用户行层级必须为 1–20")
        var level = listOf(container)
        repeat(depth) { level = level.flatMap { parent ->
            (0 until parent.childCount).mapNotNull(parent::getChild)
        } }
        val selector = args.getJSONObject("row")
        return level.filter { matches(it, selector) }.sortedWith(compareBy<AccessibilityNodeInfo> {
            AccessibilityBridge.bounds(it).top
        }.thenBy { AccessibilityBridge.bounds(it).left })
    }

    private fun matches(node: AccessibilityNodeInfo, selector: JSONObject): Boolean {
        val value = selector.getString("value")
        return when (selector.getString("kind")) {
            "resourceId" -> node.viewIdResourceName == value
            "description" -> node.contentDescription?.toString() == value
            "text" -> node.text?.toString() == value
            "className" -> node.className?.toString() == value
            else -> error("未知定位方式")
        }
    }

    private fun children(root: AccessibilityNodeInfo, selector: JSONObject): List<AccessibilityNodeInfo> =
        AccessibilityBridge.matches(selector, root).filter { it != root }

    private fun failure(reason: String): JSONObject = JSONObject().put("ok", false).put("reason", reason)
}
