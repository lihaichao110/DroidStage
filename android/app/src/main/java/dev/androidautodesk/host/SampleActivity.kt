package dev.androidautodesk.host

import android.app.Activity
import android.os.Bundle
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView

class SampleActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
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
}
