/**
 * 行状态设备测试：在模拟列表核对固定层级扫描、点击前重查及原行状态确认。
 */
package dev.androidautodesk.host

import android.app.Activity
import android.content.Intent
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.Configurator
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class RowStateOperationsTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val device = UiDevice.getInstance(instrumentation)
    private val operations = RowStateOperations(ElementLocator(device))
    private lateinit var activity: Activity

    @Before
    fun openFixture() {
        Configurator.getInstance().setWaitForIdleTimeout(100)
        val intent = Intent(instrumentation.targetContext, SampleActivity::class.java)
            .putExtra("rowStateFixture", true)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
        activity = instrumentation.startActivitySync(intent)
        assertTrue("模拟列表未显示；请确认设备已解锁，当前前台=${device.currentPackageName}",
            device.wait(Until.hasObject(By.res("dev.androidautodesk.host:id/test_list")), 5000))
    }

    @After
    fun closeFixture() {
        instrumentation.runOnMainSync { activity.finish() }
    }

    @Test
    fun scansOnlyRowsAndConfirmsSamePosition() {
        val args = selectors()
        val first = operations.scan(args)
        assertEquals(4, first.length()) // 内层同类名 FrameLayout 不应混成额外用户行
        assertEquals("pending", first.getJSONObject(0).getString("status"))
        assertEquals("completed", first.getJSONObject(1).getString("status"))

        val wrongBounds = tapArgs(args, first, 1).put("bounds", first.getJSONObject(1).getJSONObject("bounds"))
        assertFalse(operations.tap(wrongBounds).getBoolean("ok"))
        assertEquals("pending", operations.scan(args).getJSONObject(0).getString("status"))

        assertTrue(operations.tap(tapArgs(args, first, 1)).getBoolean("ok"))
        assertEquals("completed", operations.scan(args).getJSONObject(0).getString("status"))
        val failed = operations.tap(tapArgs(args, first, 3))
        assertTrue(failed.getBoolean("ok"))
        assertFalse(failed.getBoolean("confirmed"))
        assertTrue(failed.getString("reason").contains("原行未出现已关注状态"))
        assertTrue(operations.tap(tapArgs(args, first, 4)).getBoolean("ok"))
    }

    /** 顶部裁切不应掩盖仍可见且唯一的待点击按钮，点击后仍须确认原行状态。 */
    @Test
    fun recognizesPendingButtonInClippedTopRow() {
        openClippedFixture("pending")
        val args = selectors()
        val rows = operations.scan(args)
        assertTopRowClipped(rows)
        assertEquals("pending", rows.getJSONObject(0).getString("status"))
        assertTrue(rows.getJSONObject(0).isNull("error"))
        assertTrue(operations.tap(tapArgs(args, rows, 1)).getBoolean("ok"))
        assertEquals("completed", operations.scan(args).getJSONObject(0).getString("status"))
    }

    /** 顶部裁切不应把可见的完成状态误报为状态含糊。 */
    @Test
    fun recognizesCompletedButtonInClippedTopRow() {
        openClippedFixture("completed")
        val rows = operations.scan(selectors())
        assertTopRowClipped(rows)
        assertEquals("completed", rows.getJSONObject(0).getString("status"))
        assertTrue(rows.getJSONObject(0).isNull("error"))
    }

    /** 首行状态控件已被裁掉时，仍提示用户把该行滚动到可见位置。 */
    @Test
    fun explainsClippedTopRowWhenStateIsInvisible() {
        openClippedFixture("missing")
        val rows = operations.scan(selectors())
        assertTopRowClipped(rows)
        val first = rows.getJSONObject(0)
        assertEquals("missing", first.getString("status"))
        assertTrue(first.getString("error").contains("滚动到完整可见"))
    }

    /** 重新打开专用夹具，确保顶部裁切来自滚动视口而非人为伪造的边界。 */
    private fun openClippedFixture(firstState: String) {
        instrumentation.runOnMainSync { activity.finish() }
        val intent = Intent(instrumentation.targetContext, SampleActivity::class.java)
            .putExtra("clippedRowFixture", firstState)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
        activity = instrumentation.startActivitySync(intent)
        instrumentation.waitForIdleSync()
        assertTrue(device.wait(Until.hasObject(By.res("dev.androidautodesk.host:id/test_list")), 5000))
    }

    /** 验证首行可见高度确实小于正常行的一半，避免测试误走完整行路径。 */
    private fun assertTopRowClipped(rows: JSONArray) {
        assertTrue(rows.length() >= 2)
        val first = rows.getJSONObject(0).getJSONObject("bounds")
        val second = rows.getJSONObject(1).getJSONObject("bounds")
        assertTrue((first.getInt("bottom") - first.getInt("top")) * 2 < second.getInt("bottom") - second.getInt("top"))
    }

    /** 使用资源 ID 定位容器、同层 FrameLayout 定位用户行。 */
    private fun selectors(): JSONObject = JSONObject()
        .put("container", selector("resourceId", "dev.androidautodesk.host:id/test_list"))
        .put("row", selector("className", "android.widget.FrameLayout"))
        .put("rowDepth", 1)
        .put("action", selector("text", "关注"))
        .put("completed", selector("text", "已关注"))

    private fun selector(kind: String, value: String) = JSONObject().put("kind", kind).put("value", value)

    private fun tapArgs(args: JSONObject, rows: JSONArray, index: Int): JSONObject = JSONObject(args.toString())
        .put("index", index)
        .put("bounds", rows.getJSONObject(index - 1).getJSONObject("bounds"))
        .put("timeoutMs", 500)
}
