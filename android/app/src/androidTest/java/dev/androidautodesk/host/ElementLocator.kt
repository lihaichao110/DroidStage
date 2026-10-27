/**
 * 手机端控件定位：按可见边界排序，并安全处理显式匹配序号。
 */
package dev.androidautodesk.host

import androidx.test.uiautomator.By
import androidx.test.uiautomator.BySelector
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.UiObject2
import org.json.JSONArray
import org.json.JSONObject

internal class ElementLocator(private val device: UiDevice) {
    /** 将任务中的定位条件转成 UI Automator 查询。 */
    fun selector(json: JSONObject): BySelector {
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

    /** 返回按屏幕位置排序的所有匹配控件；边界排序与编辑器预览一致。 */
    fun matches(json: JSONObject): List<UiObject2> = device.findObjects(selector(json)).sortedWith(
        compareBy<UiObject2> { it.visibleBounds.top }.thenBy { it.visibleBounds.left }
            .thenBy { it.visibleBounds.bottom }.thenBy { it.visibleBounds.right }
    )

    /** 有序号时只报告指定候选；数量不足即报错，避免条件分支误判为不存在。 */
    fun count(json: JSONObject): Int {
        val found = matches(json)
        val index = index(json) ?: return found.size
        if (found.size < index) error("匹配控件不足 $index 个")
        ensureDistinct(found, index)
        return 1
    }

    /** 查询实时位置，供编辑器标注候选边界。 */
    fun inspect(json: JSONObject): JSONArray = JSONArray().also { result ->
        matches(json).forEachIndexed { offset, node ->
            val bounds = node.visibleBounds
            result.put(JSONObject().put("index", offset + 1).put("bounds", JSONObject()
                .put("left", bounds.left).put("top", bounds.top)
                .put("right", bounds.right).put("bottom", bounds.bottom)))
        }
    }

    /** 重查直到目标出现；序号目标不足时超时明确失败，绝不回退点击其它候选。 */
    fun findUnique(json: JSONObject, timeoutMs: Long): UiObject2 {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (true) {
            val found = matches(json)
            val index = index(json)
            if (index == null && found.size > 1) error("定位条件匹配多个控件")
            if (index != null && found.size >= index) {
                ensureDistinct(found, index)
                return found[index - 1]
            }
            if (index == null && found.size == 1) return found[0]
            if (System.currentTimeMillis() >= deadline) error(if (index == null) "未找到控件" else "匹配控件不足 $index 个")
            Thread.sleep(200)
        }
    }

    private fun index(json: JSONObject): Int? {
        if (!json.has("matchIndex")) return null
        val index = json.getInt("matchIndex")
        if (index !in 1..10000) error("匹配序号无效")
        return index
    }

    private fun ensureDistinct(found: List<UiObject2>, index: Int) {
        val target = found[index - 1].visibleBounds
        if (found.anyIndexed { position, node -> position != index - 1 && node.visibleBounds == target }) error("匹配控件位置无法区分")
    }

    private inline fun <T> List<T>.anyIndexed(predicate: (Int, T) -> Boolean): Boolean {
        forEachIndexed { index, item -> if (predicate(index, item)) return true }
        return false
    }
}
