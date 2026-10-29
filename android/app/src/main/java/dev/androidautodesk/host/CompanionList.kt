/**
 * 无线直连的身份列表操作：通过无障碍树逐行重查，避免滚动后误点旧坐标。
 */
package dev.androidautodesk.host

import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONArray
import org.json.JSONObject

internal object CompanionList {
    /** 只扫描容器内的行，重复身份和不完整行都显式标错。 */
    fun scan(args: JSONObject): JSONArray {
        val container = AccessibilityBridge.findUnique(args.getJSONObject("container"), 0)
        val rows = rows(container, args)
        val keys = rows.map { field(it, args.getJSONObject("identity")) }
        val duplicates = keys.filter { it.isNotBlank() }.groupingBy { it }.eachCount().filterValues { it > 1 }.keys
        val fullHeight = rows.maxOfOrNull { AccessibilityBridge.bounds(it).height() } ?: 0
        val containerBottom = AccessibilityBridge.bounds(container).bottom
        return JSONArray().also { result ->
            rows.forEachIndexed { index, row ->
                val name = field(row, args.getJSONObject("name"))
                val key = keys[index]
                val actions = children(row, args.getJSONObject("action"))
                val completed = children(row, args.getJSONObject("completed"))
                val bounds = AccessibilityBridge.bounds(row)
                val deferred = fullHeight > 0 && bounds.height() * 2 < fullHeight &&
                    bounds.bottom >= containerBottom &&
                    (name.isBlank() || key.isBlank() || (actions.isEmpty() && completed.isEmpty()))
                val reason = when {
                    name.isBlank() -> "未找到显示名称"
                    key.isBlank() -> "未找到唯一标识"
                    key in duplicates -> "当前屏有重复的唯一标识"
                    actions.size > 1 -> "行内点击控件不唯一"
                    completed.size > 1 -> "行内完成状态控件不唯一"
                    actions.isNotEmpty() && completed.isNotEmpty() -> "待点击与完成状态同时存在"
                    else -> null
                }
                result.put(JSONObject().put("name", name).put("key", key)
                    .put("hasAction", actions.size == 1).put("hasCompleted", completed.size == 1)
                    .put("deferred", deferred).put("error", reason))
            }
        }
    }

    /** 按唯一标识重新定位，点击后只在同一行确认完成状态。 */
    fun tap(args: JSONObject): JSONObject {
        val key = args.getString("key")
        val deadline = System.currentTimeMillis() + args.optLong("timeoutMs", 10000)
        val row = findRow(args, key) ?: return failure("目标用户行已消失")
        val actions = children(row, args.getJSONObject("action"))
        if (actions.size != 1) return failure("待点击控件数量为 ${actions.size}")
        try { AccessibilityBridge.tap(actions[0]) }
        catch (error: Exception) { return failure("点击失败：${error.message}") }
        while (true) {
            val current = findRow(args, key)
            if (current != null) {
                val done = children(current, args.getJSONObject("completed"))
                val pending = children(current, args.getJSONObject("action"))
                if (done.size == 1 && pending.isEmpty()) return JSONObject().put("ok", true)
            }
            if (System.currentTimeMillis() >= deadline) return failure("点击后未在同一用户行看到完成状态")
            Thread.sleep(200)
        }
    }

    private fun findRow(args: JSONObject, key: String): AccessibilityNodeInfo? {
        val container = AccessibilityBridge.findUnique(args.getJSONObject("container"), 0)
        val found = rows(container, args).filter { field(it, args.getJSONObject("identity")) == key }
        return found.singleOrNull()
    }

    private fun rows(container: AccessibilityNodeInfo, args: JSONObject): List<AccessibilityNodeInfo> =
        children(container, args.getJSONObject("row")).sortedWith(compareBy<AccessibilityNodeInfo> {
            AccessibilityBridge.bounds(it).top
        }.thenBy { AccessibilityBridge.bounds(it).left })

    private fun field(row: AccessibilityNodeInfo, selector: JSONObject): String {
        val found = children(row, selector)
        if (found.size != 1) return ""
        return found[0].text?.toString()?.trim()?.takeIf(String::isNotEmpty)
            ?: found[0].contentDescription?.toString()?.trim() ?: ""
    }

    private fun children(root: AccessibilityNodeInfo, selector: JSONObject): List<AccessibilityNodeInfo> =
        AccessibilityBridge.matches(selector, root).filter { it != root }

    private fun failure(reason: String): JSONObject = JSONObject().put("ok", false).put("reason", reason)
}
