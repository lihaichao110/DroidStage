/**
 * 输入操作：写入后核对控件实际文本，避免将无效写入报告为成功。
 */
package dev.androidautodesk.host

import android.os.SystemClock
import androidx.test.uiautomator.UiObject2
import org.json.JSONObject

internal class InputOperations(private val locator: ElementLocator) {
    private companion object {
        const val VERIFY_WAIT_MS = 1500L // 观察应用异步更新和随后清空输入框的短暂时间
        const val STABLE_TEXT_MS = 300L // 防止短暂出现后又被应用清空的文本被误判为成功
        const val POLL_INTERVAL_MS = 100L // 控件树更新比单帧慢，短轮询即可覆盖常见延迟
        const val RETRY_FIND_MS = 1000L // 点击聚焦后给重新创建的输入框短暂出现时间
    }

    private data class Verification(val isMatch: Boolean, val reason: String)

    /**
     * 向唯一目标写入文本并核对结果；首次失败时点击聚焦后重试一次。
     * @param selector 任务指定的控件定位条件
     * @param text 期望写入的完整文本
     * @param timeoutMs 首次查找目标的超时时间
     * @throws 控件无法定位、文本无法读取或两次写入后内容仍不一致时抛出
     */
    fun input(selector: JSONObject, text: String, timeoutMs: Long) {
        val target = locator.findUnique(selector, timeoutMs)
        val firstWriteError = write(target, text)
        val first = verify(selector, text)
        if (first.isMatch) return

        var retryError: String? = null
        try {
            // 某些页面首次无焦点时会忽略写入；重新点击并查找可避免沿用点击前的旧节点。
            locator.findUnique(selector, 0).click()
            val focused = locator.findUnique(selector, RETRY_FIND_MS)
            retryError = write(focused, text)
        } catch (error: Exception) {
            retryError = error.message ?: error.javaClass.simpleName
        }
        val second = verify(selector, text)
        if (second.isMatch) return

        val targetLabel = "${selector.getString("kind")}：${selector.getString("value")}" +
            (if (selector.has("matchIndex")) " · 第 ${selector.getInt("matchIndex")} 个" else "")
        val firstReason = firstWriteError?.let { "写入报错（$it），${first.reason}" } ?: first.reason
        val secondReason = retryError?.let { "写入报错（$it），${second.reason}" } ?: second.reason
        error("输入未生效（$targetLabel）：首次$firstReason；聚焦重试后$secondReason")
    }

    /** 写入异常留给核对与重试处理；只记录异常类型，避免底层异常意外带出输入正文。 */
    private fun write(target: UiObject2, text: String): String? = try {
        target.setText(text)
        null
    } catch (error: Exception) {
        error.javaClass.simpleName
    }

    /** 每次重新定位并读取文本，观察期结束时内容仍稳定一致才确认成功。 */
    private fun verify(selector: JSONObject, text: String): Verification {
        val deadline = SystemClock.elapsedRealtime() + VERIFY_WAIT_MS
        var matchedAt: Long? = null
        var reason = "控件文本尚未更新"
        while (true) {
            val now = SystemClock.elapsedRealtime()
            try {
                val observed = locator.findUnique(selector, 0).text
                if (observed == text) {
                    if (matchedAt == null) matchedAt = now
                    reason = "文本未保持稳定"
                } else {
                    matchedAt = null
                    reason = if (observed == null) "控件文本不可读取" else "文本不一致（实际 ${observed.length} 字）"
                }
            } catch (error: Exception) {
                matchedAt = null
                reason = error.message ?: "控件无法重新定位"
            }
            val remaining = deadline - SystemClock.elapsedRealtime()
            if (remaining <= 0) {
                val isStable = matchedAt != null && SystemClock.elapsedRealtime() - matchedAt >= STABLE_TEXT_MS
                return Verification(isStable, if (isStable) "已核对" else reason)
            }
            Thread.sleep(minOf(POLL_INTERVAL_MS, remaining))
        }
    }
}
