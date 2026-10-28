/**
 * 本地测试页：提供基础输入控件和供设备测试使用的模拟关注列表。
 */
package dev.androidautodesk.host

import android.app.Activity
import android.os.Bundle
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

class SampleActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (intent.getBooleanExtra("rowStateFixture", false)) {
            showRowStateFixture()
            return
        }
        if (intent.hasExtra("clippedRowFixture")) {
            showClippedRowFixture(intent.getStringExtra("clippedRowFixture") ?: "pending")
            return
        }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 48, 32, 32)
        }
        val input = EditText(this).apply {
            id = R.id.test_input
            hint = "输入中文或英文"
            contentDescription = "测试输入框"
        }
        val result = TextView(this).apply {
            id = R.id.test_result
            text = "等待操作"
            textSize = 20f
        }
        val button = Button(this).apply {
            id = R.id.test_button
            text = "确认"
            setOnClickListener { result.text = input.text.toString() }
        }
        root.addView(input, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        root.addView(button, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        root.addView(result, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        setContentView(root)
    }

    /** 模拟仅能读取行和按钮状态的列表，并放入同类名内层控件验证层级过滤。 */
    private fun showRowStateFixture() {
        val list = LinearLayout(this).apply {
            id = R.id.test_list
            orientation = LinearLayout.VERTICAL
            importantForAccessibility = android.view.View.IMPORTANT_FOR_ACCESSIBILITY_YES
        }
        for (index in 0 until 4) {
            val row = FrameLayout(this).apply {
                id = R.id.test_row
                importantForAccessibility = android.view.View.IMPORTANT_FOR_ACCESSIBILITY_YES
            }
            val nested = FrameLayout(this).apply {
                id = R.id.test_nested
                importantForAccessibility = android.view.View.IMPORTANT_FOR_ACCESSIBILITY_YES
            }
            val follow = Button(this).apply {
                id = R.id.test_follow
                text = if (index == 1) "已关注" else "关注"
                setOnClickListener { if (index != 2) text = "已关注" }
            }
            nested.addView(follow, FrameLayout.LayoutParams(240, 100).apply { gravity = android.view.Gravity.RIGHT })
            row.addView(nested, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 110))
            list.addView(row, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 140))
        }
        setContentView(list)
    }

    /** 模拟首行只露出不足一半的真实滚动列表，区分可见与已裁掉的状态按钮。 */
    private fun showClippedRowFixture(firstState: String) {
        val list = LinearLayout(this).apply {
            id = R.id.test_list
            orientation = LinearLayout.VERTICAL
            importantForAccessibility = android.view.View.IMPORTANT_FOR_ACCESSIBILITY_YES
        }
        for (index in 0 until 4) {
            val row = FrameLayout(this).apply {
                id = R.id.test_row
                importantForAccessibility = android.view.View.IMPORTANT_FOR_ACCESSIBILITY_YES
            }
            val follow = Button(this).apply {
                id = R.id.test_follow
                text = if (index == 0 && firstState == "completed") "已关注" else "关注"
                setOnClickListener { text = "已关注" }
            }
            // missing 场景把按钮放在裁切区域；其余场景将按钮留在首行可见区域。
            val gravity = if (index == 0 && firstState == "missing") android.view.Gravity.TOP else android.view.Gravity.BOTTOM
            row.addView(follow, FrameLayout.LayoutParams(240, 80).apply { this.gravity = gravity or android.view.Gravity.RIGHT })
            list.addView(row, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 240))
        }
        val scroll = ScrollView(this).apply { addView(list) }
        val root = FrameLayout(this).apply {
            // 固定视口高度让首行可裁切，后续正常行仍完整可见，形成可靠的行高参照。
            addView(scroll, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 600))
        }
        setContentView(root)
        scroll.post { scroll.scrollTo(0, 130) }
    }
}
