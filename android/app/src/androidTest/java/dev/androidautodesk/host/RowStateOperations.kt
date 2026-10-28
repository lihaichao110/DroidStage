/**
 * 无身份列表操作：按容器内固定层级读取用户行，并在原位置确认状态变化。
 */
package dev.androidautodesk.host

import android.graphics.Rect
import androidx.test.uiautomator.StaleObjectException
import androidx.test.uiautomator.UiObject2
import org.json.JSONArray
import org.json.JSONObject

internal class RowStateOperations(private val locator: ElementLocator) {

    // 页面加载、浮层或点击动效会让列表容器在控件树中消失数秒，重查窗口须覆盖整个动效期
    private companion object { const val LOCATE_RETRY_MS = 8000L }

    /** 只检查指定层级的用户行，避免同类名的行内容器混入结果。 */
    fun scan(args: JSONObject): JSONArray {
        // 抖音列表的图片加载与动画会不断刷新控件树，节点引用随时失效；整体重查仍失败才放弃。
        val deadline = System.currentTimeMillis() + LOCATE_RETRY_MS
        while (true) {
            try { return scanOnce(args) } catch (error: Exception) {
                if (error !is StaleObjectException && error !is IllegalStateException) throw error
                if (System.currentTimeMillis() >= deadline) error("列表扫描时控件树持续刷新，请重试")
                Thread.sleep(200)
            }
        }
    }

    private fun scanOnce(args: JSONObject): JSONArray {
        val container = locator.findUnique(args.getJSONObject("container"), 0)
        val rows = rows(container, args)
        val height = rows.maxOfOrNull { it.visibleBounds.height() } ?: 0
        val boundsCount = rows.groupingBy { it.visibleBounds.toShortString() }.eachCount()
        return JSONArray().also { result ->
            rows.forEachIndexed { offset, row ->
                // 单行节点失效只标记该行跳过，不能让一行动画毁掉整屏扫描结果。
                val entry = try { scanRow(row, offset + 1, container, args, height, boundsCount) } catch (_: StaleObjectException) { null }
                result.put(entry ?: JSONObject().put("index", offset + 1).put("bounds", boundsJson(Rect()))
                    .put("status", "missing").put("deferred", false).put("error", "行控件已刷新"))
            }
        }
    }

    private fun scanRow(
        row: UiObject2,
        index: Int,
        container: UiObject2,
        args: JSONObject,
        height: Int,
        boundsCount: Map<String, Int>
    ): JSONObject {
        val bounds = row.visibleBounds
        val pending = row.findObjects(locator.selector(args.getJSONObject("action"))).size
        val completed = row.findObjects(locator.selector(args.getJSONObject("completed"))).size
        val isPartial = height > 0 && bounds.height() * 2 < height
        // 首行虽被裁切，行内按钮仍可明确归属时应保留状态；只有按钮不可见才要求露出整行。
        val isTopPartial = isPartial && bounds.top <= container.visibleBounds.top
        val deferred = isPartial && !isTopPartial && bounds.bottom >= container.visibleBounds.bottom
        val error = when {
            bounds.width() <= 0 || bounds.height() <= 0 -> "用户行没有可见边界"
            boundsCount[bounds.toShortString()] != 1 -> "多条用户行边界重合"
            pending > 1 -> "行内待点击控件不唯一"
            completed > 1 -> "行内完成状态控件不唯一"
            pending > 0 && completed > 0 -> "待点击与完成状态同时存在"
            isTopPartial && pending == 0 && completed == 0 -> "用户行顶部不完整且状态不可见，请将该行滚动到完整可见后重试"
            pending == 0 && completed == 0 -> "未识别关注或已关注状态"
            else -> null
        }
        val status = when {
            error != null && pending == 0 && completed == 0 -> "missing"
            error != null -> "ambiguous"
            pending == 1 -> "pending"
            else -> "completed"
        }
        return JSONObject().put("index", index).put("bounds", boundsJson(bounds))
            .put("status", status).put("deferred", deferred).put("error", error)
    }

    /** 点击前重查序号与边界，点击后优先在原位置确认完成状态。 */
    fun tap(args: JSONObject): JSONObject {
        val index = args.getInt("index")
        val expected = args.getJSONObject("bounds")
        val deadline = System.currentTimeMillis() + args.getLong("timeoutMs")
        // 点击尚未发生，定位失败时安全跳过该行，绝不能凭旧位置盲点。
        val row = locateRow(args, index, expected, System.currentTimeMillis() + LOCATE_RETRY_MS)
            ?: return failure("点击前控件树已刷新，跳过该行")
        val action: List<UiObject2>
        val completed: List<UiObject2>
        try {
            action = row.findObjects(locator.selector(args.getJSONObject("action")))
            completed = row.findObjects(locator.selector(args.getJSONObject("completed")))
        } catch (_: StaleObjectException) {
            return failure("点击前控件树已刷新，跳过该行")
        }
        if (action.size != 1 || completed.isNotEmpty()) return failure("点击前关注状态已变化")
        try { action[0].click() } catch (error: Exception) {
            return failure("点击失败：${error.message ?: error.javaClass.simpleName}")
        }
        while (true) {
            // 点击已发出：行消失或树刷新只代表暂时无法原位确认，轮询至超时后交给上层屏幕级复核。
            try {
                val current = currentRow(args, index, expected)
                    ?: return unconfirmed("点击后用户行位置已变化")
                val done = current.findObjects(locator.selector(args.getJSONObject("completed")))
                val pending = current.findObjects(locator.selector(args.getJSONObject("action")))
                if (done.size == 1 && pending.isEmpty()) return JSONObject().put("ok", true).put("confirmed", true)
            } catch (error: Exception) {
                if (error !is StaleObjectException && error !is IllegalStateException) throw error
            }
            if (System.currentTimeMillis() >= deadline) return unconfirmed("点击后原行未出现已关注状态")
            Thread.sleep(200)
        }
    }

    /** 点击已发出但无法在原位核实结果：不判定失败，由桌面端屏幕级复核确认。 */
    private fun unconfirmed(reason: String): JSONObject =
        JSONObject().put("ok", true).put("confirmed", false).put("reason", reason)

    /** 在截止时间前重查目标行；容器短暂消失可恢复，超时仍失败则由调用方跳过或转屏幕级复核。 */
    private fun locateRow(args: JSONObject, index: Int, expected: JSONObject, deadline: Long): UiObject2? {
        while (true) {
            try {
                return currentRow(args, index, expected)
            } catch (error: Exception) {
                if (error !is StaleObjectException && error !is IllegalStateException) throw error
                if (System.currentTimeMillis() >= deadline) return null
                Thread.sleep(200)
            }
        }
    }

    private fun currentRow(args: JSONObject, index: Int, expected: JSONObject): UiObject2? {
        val container = locator.findUnique(args.getJSONObject("container"), 0)
        val row = rows(container, args).getOrNull(index - 1) ?: return null
        val bounds = row.visibleBounds
        return row.takeIf { bounds.left == expected.getInt("left") && bounds.top == expected.getInt("top") &&
            bounds.right == expected.getInt("right") && bounds.bottom == expected.getInt("bottom") }
    }

    private fun rows(container: UiObject2, args: JSONObject): List<UiObject2> {
        val depth = args.getInt("rowDepth")
        if (depth !in 1..20) error("用户行层级必须为 1–20")
        var level = listOf(container)
        repeat(depth) { level = level.flatMap { it.children } }
        val selector = args.getJSONObject("row")
        return level.filter { matches(it, selector) }.sortedWith(
            compareBy<UiObject2> { it.visibleBounds.top }.thenBy { it.visibleBounds.left }
        )
    }

    /** 对固定层级节点按任务属性做精确匹配，避免再次递归查找。 */
    private fun matches(node: UiObject2, selector: JSONObject): Boolean {
        val value = selector.getString("value")
        return when (selector.getString("kind")) {
            "resourceId" -> node.resourceName == value
            "description" -> node.contentDescription == value
            "text" -> node.text == value
            "className" -> node.className == value
            else -> error("未知定位方式")
        }
    }

    private fun boundsJson(bounds: Rect) = JSONObject().put("left", bounds.left).put("top", bounds.top)
        .put("right", bounds.right).put("bottom", bounds.bottom)

    private fun failure(reason: String) = JSONObject().put("ok", false).put("reason", reason)
}
