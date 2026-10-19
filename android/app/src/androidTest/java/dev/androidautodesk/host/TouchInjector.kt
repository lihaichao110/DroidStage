package dev.androidautodesk.host

import android.app.UiAutomation
import android.os.SystemClock
import android.view.InputDevice
import android.view.MotionEvent
import org.json.JSONObject

/**
 * 触摸/滚轮注入器：把桌面端投屏画面上的鼠标手势转换为系统输入事件。
 *
 * 走 UiAutomation 连接的 injectInputEvent（shell 级权限，可跨应用注入）；
 * sync=false 异步注入，不等待系统 idle，延迟最低——连续手势（拖拽）必须用这一路径，
 * 现有 device.click/swipe 是同步等 idle 的高层封装，无法承载高频事件流。
 */
class TouchInjector(private val automation: UiAutomation) {
    // 当前手势按下的时刻：DOWN/MOVE/UP 必须共用同一 downTime，否则系统会当作断裂手势丢弃
    @Volatile
    private var downTime = 0L

    /**
     * 注入触摸事件。
     * @param args action 取 down/move/up/cancel；x/y 为当前屏幕方向坐标（浮点）；
     * move 可携带 points 数组批量注入——拖拽时鼠标高频移动，合并成一次请求抵消 adb 往返延迟
     * @return 固定返回 "ok"，失败抛异常由上层折成错误响应
     * @throws 手势未开始就收到 move/up、或系统拒绝注入时抛出
     */
    fun touch(args: JSONObject): String {
        val action = when (args.getString("action")) {
            "down" -> MotionEvent.ACTION_DOWN
            "move" -> MotionEvent.ACTION_MOVE
            "up" -> MotionEvent.ACTION_UP
            "cancel" -> MotionEvent.ACTION_CANCEL
            else -> error("未知触摸动作")
        }
        when (action) {
            MotionEvent.ACTION_DOWN -> {
                downTime = SystemClock.uptimeMillis()
                injectEvent(action, args.getDouble("x").toFloat(), args.getDouble("y").toFloat())
            }
            MotionEvent.ACTION_MOVE -> {
                if (downTime == 0L) error("没有进行中的手势")
                if (args.has("points")) {
                    val array = args.getJSONArray("points")
                    for (index in 0 until array.length()) {
                        val point = array.getJSONObject(index)
                        injectEvent(action, point.getDouble("x").toFloat(), point.getDouble("y").toFloat())
                    }
                } else {
                    injectEvent(action, args.getDouble("x").toFloat(), args.getDouble("y").toFloat())
                }
            }
            else -> {
                if (downTime == 0L) error("没有进行中的手势")
                injectEvent(action, args.getDouble("x").toFloat(), args.getDouble("y").toFloat())
                downTime = 0L
            }
        }
        return "ok"
    }

    /**
     * 在指定坐标注入滚轮事件。
     * @param args x/y 滚动位置；dy 滚动量，正值向下滚（与浏览器 wheel deltaY 同号）
     */
    fun scroll(args: JSONObject): String {
        val now = SystemClock.uptimeMillis()
        val properties = MotionEvent.PointerProperties().apply {
            id = 0
            toolType = MotionEvent.TOOL_TYPE_MOUSE
        }
        val coordinates = MotionEvent.PointerCoords().apply {
            x = args.getDouble("x").toFloat()
            y = args.getDouble("y").toFloat()
            pressure = 1f
            size = 1f
            // 浏览器每格滚轮 deltaY≈100，系统滚轮以“格”为单位，换算回格数
            setAxisValue(MotionEvent.AXIS_VSCROLL, (args.getDouble("dy") / 100).toFloat())
        }
        val event = MotionEvent.obtain(now, now, MotionEvent.ACTION_SCROLL, 1,
            arrayOf(properties), arrayOf(coordinates), 0, 0, 1f, 1f, 0, 0, SOURCE_ANY, 0)
        try {
            if (!automation.injectInputEvent(event, false)) error("滚轮注入失败")
        } finally {
            event.recycle()
        }
        return "ok"
    }

    /** 构造单指触摸事件并异步注入；注入失败抛错，事件对象无论成败都回收。 */
    private fun injectEvent(action: Int, x: Float, y: Float) {
        val event = MotionEvent.obtain(downTime, SystemClock.uptimeMillis(), action, x, y,
            1f, 1f, 0, 1f, 1f, 0, 0, InputDevice.SOURCE_TOUCHSCREEN)
        try {
            if (!automation.injectInputEvent(event, false)) error("触摸注入失败")
        } finally {
            event.recycle()
        }
    }

    private companion object {
        // InputDevice.SOURCE_ANY 是隐藏常量（scrcpy 同款用法）：滚轮不绑定具体设备来源，
        // 让系统按 generic motion 派发给光标下窗口
        const val SOURCE_ANY = 0x00ffffff
    }
}
