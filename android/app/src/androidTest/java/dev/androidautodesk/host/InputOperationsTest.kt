/**
 * 输入操作设备测试：在项目测试页核对真实可编辑控件及不可编辑控件的结果。
 */
package dev.androidautodesk.host

import android.app.Activity
import android.content.Intent
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.Configurator
import androidx.test.uiautomator.UiDevice
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class InputOperationsTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val locator = ElementLocator(UiDevice.getInstance(instrumentation))
    private val inputs = InputOperations(locator)
    private lateinit var activity: Activity

    /** 每个用例重建空白测试页，避免输入内容和焦点互相影响。 */
    @Before
    fun openPage() {
        Configurator.getInstance().setWaitForIdleTimeout(100)
        val intent = Intent(instrumentation.targetContext, SampleActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
        activity = instrumentation.startActivitySync(intent)
    }

    @After
    fun closePage() {
        instrumentation.runOnMainSync { activity.finish() }
    }

    @Test
    fun writesChineseAndEnglish() {
        inputs.input(selector("test_input"), "中文abc", 5000)
        assertEquals("中文abc", locator.findUnique(selector("test_input"), 0).text)
        inputs.input(selector("test_input"), "Hello", 5000)
        assertEquals("Hello", locator.findUnique(selector("test_input"), 0).text)
    }

    @Test
    fun clearsExistingText() {
        inputs.input(selector("test_input"), "先填内容", 5000)
        inputs.input(selector("test_input"), "", 5000)
        assertEquals("", locator.findUnique(selector("test_input"), 0).text)
    }

    @Test
    fun reportsNonEditableTargetAsFailure() {
        try {
            inputs.input(selector("test_result"), "不能写入", 5000)
            fail("不可编辑控件不应报告输入成功")
        } catch (error: IllegalStateException) {
            assertTrue(error.message.orEmpty().contains("输入未生效"))
            assertTrue(error.message.orEmpty().contains("test_result"))
            assertTrue(!error.message.orEmpty().contains("不能写入"))
        }
    }

    /** 使用稳定资源 ID 定位测试页控件，避免正文变化影响重新查找。 */
    private fun selector(name: String): JSONObject = JSONObject()
        .put("kind", "resourceId")
        .put("value", "dev.androidautodesk.host:id/$name")
}
