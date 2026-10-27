/**
 * 滚动列表操作：逐行读取、按唯一标识重查点击和确认状态。
 */
package dev.androidautodesk.host

import androidx.test.uiautomator.Direction
import androidx.test.uiautomator.UiObject2
import org.json.JSONArray
import org.json.JSONObject

internal class ListOperations(private val locator: ElementLocator) {
    /** 只读取指定容器的行，避免页面其它同名按钮混入处理。 */
    fun scan(args: JSONObject): JSONArray {
        val container = locator.findUnique(args.getJSONObject("container"), 0)
        val containerBounds = container.visibleBounds
        val rows = rows(container, args)
        val fullRowHeight = rows.maxOfOrNull { it.visibleBounds.height() } ?: 0
        val keys = rows.map { field(it, args.getJSONObject("identity")) }
        val duplicates = keys.filter { it.isNotBlank() }.groupingBy { it }.eachCount().filterValues { it > 1 }.keys
        return JSONArray().also { result ->
            rows.forEachIndexed { index, row ->
                val name = field(row, args.getJSONObject("name"))
                val key = keys[index]
                val actions = row.findObjects(locator.selector(args.getJSONObject("action")))
                val completed = row.findObjects(locator.selector(args.getJSONObject("completed")))
                // 列表边缘只露出一部分的行可能尚未包含名称或按钮，留到下一屏再判定。
                val bounds = row.visibleBounds
                val isEdgePartial = bounds.bottom >= containerBounds.bottom &&
                    bounds.height() * 2 < fullRowHeight &&
                    (name.isBlank() || key.isBlank() || (actions.isEmpty() && completed.isEmpty()))
                val error = when {
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
                    .put("deferred", isEdgePartial)
                    .put("error", error))
            }
        }
    }

    /** 按行内唯一标识重新定位后点击，轮询同一行的完成状态。 */
    fun tap(args: JSONObject): JSONObject {
        val key = args.getString("key")
        val timeout = args.getLong("timeoutMs")
        val deadline = System.currentTimeMillis() + timeout
        val row = findRow(args, key) ?: return failure("目标用户行已消失")
        val actions = row.findObjects(locator.selector(args.getJSONObject("action")))
        if (actions.size != 1) return failure("待点击控件数量为 ${actions.size}")
        try { actions[0].click() } catch (error: Exception) { return failure("点击失败：${error.message ?: error.javaClass.simpleName}") }
        while (true) {
            val current = findRow(args, key)
            if (current != null) {
                val done = current.findObjects(locator.selector(args.getJSONObject("completed")))
                val pending = current.findObjects(locator.selector(args.getJSONObject("action")))
                if (done.size == 1 && pending.isEmpty()) return JSONObject().put("ok", true)
            }
            if (System.currentTimeMillis() >= deadline) return failure("点击后未在同一用户行看到完成状态")
            Thread.sleep(200)
        }
    }

    /** UI Automator 返回 false 表示容器已到末尾；由主进程再扫描末页。 */
    fun scroll(args: JSONObject): Boolean {
        val container = locator.findUnique(args.getJSONObject("container"), 0)
        return container.scroll(Direction.DOWN, 0.8f)
    }

    private fun rows(container: UiObject2, args: JSONObject): List<UiObject2> =
        container.findObjects(locator.selector(args.getJSONObject("row"))).sortedWith(
            compareBy<UiObject2> { it.visibleBounds.top }.thenBy { it.visibleBounds.left }
        )

    private fun field(row: UiObject2, selector: JSONObject): String {
        val matches = row.findObjects(locator.selector(selector))
        if (matches.size != 1) return ""
        return matches[0].text?.trim()?.takeIf { it.isNotEmpty() }
            ?: matches[0].contentDescription?.trim() ?: ""
    }

    private fun findRow(args: JSONObject, key: String): UiObject2? {
        val rows = rows(locator.findUnique(args.getJSONObject("container"), 0), args)
            .filter { field(it, args.getJSONObject("identity")) == key }
        return if (rows.size == 1) rows[0] else null
    }

    private fun failure(reason: String) = JSONObject().put("ok", false).put("reason", reason)
}
