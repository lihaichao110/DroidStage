/**
 * 比例滑动协议：在手机端实时读取屏幕与控件位置，确认方向稳定后执行并回传路径。
 */
package dev.androidautodesk.host

import android.content.Context
import android.graphics.Point
import android.hardware.display.DisplayManager
import android.view.Display
import org.json.JSONObject

internal object RelativeSwipe {
    /**
     * 两类连接共用相同的校验、换算及回执，注入动作由各自代理实现。
     * @param args 比例坐标、模式、时长和可选的区域定位
     * @param display 读取当前显示尺寸与方向
     * @param locate 按既有唯一匹配规则查找控件
     * @param inject 等待系统确认手势完成，失败必须抛出
     * @return 实际区域与像素坐标
     * @throws IllegalArgumentException 参数无效或方向改变时抛出；查询和注入错误向上传播
     */
    fun execute(args: JSONObject, display: () -> SwipeDisplay,
                locate: (JSONObject, Long) -> SwipeBounds,
                inject: (SwipePoint, SwipePoint, Long) -> Unit): JSONObject {
        val mode = args.getString("coordinateMode")
        require(mode == "screenPercent" || mode == "elementPercent") { "滑动仅支持屏幕比例或控件内比例" }
        val duration = integer(args, "durationMs", 100, 10000)
        val from = percent(args.getJSONObject("from"))
        val to = percent(args.getJSONObject("to"))
        require(from != to) { "滑动起点与终点不能相同" }
        val before = display()
        val target = if (mode == "elementPercent") {
            val timeout = integer(args, "timeoutMs", 100, 60000)
            locate(args.getJSONObject("container"), timeout)
        } else {
            require(!args.has("container") && !args.has("timeoutMs")) { "屏幕比例不支持控件区域或查找超时" }
            null
        }
        // 控件查找可能等待数秒；方向变化后旧控件坐标已失效，不能继续注入。
        val current = display()
        require(before == current) { "屏幕方向或尺寸已改变，请稳定方向后重试" }
        val path = SwipeGeometry.resolve(current, target, from, to)
        require(display() == current) { "屏幕方向或尺寸已改变，请稳定方向后重试" }
        inject(path.from, path.to, duration)
        return JSONObject().put("bounds", JSONObject().put("left", path.bounds.left).put("top", path.bounds.top)
            .put("right", path.bounds.right).put("bottom", path.bounds.bottom))
            .put("from", pointJson(path.from)).put("to", pointJson(path.to))
    }

    /** 从默认显示器读取完整像素尺寸，不依赖应用资源密度或控件树根节点。 */
    @Suppress("DEPRECATION")
    fun readDisplay(context: Context): SwipeDisplay {
        val display = context.getSystemService(DisplayManager::class.java).getDisplay(Display.DEFAULT_DISPLAY)
            ?: error("无法读取手机屏幕")
        val size = Point().also(display::getRealSize)
        return SwipeDisplay(size.x, size.y, display.rotation)
    }

    /** 拒绝数字字符串与非有限数值，保持与桌面校验一致。 */
    private fun number(json: JSONObject, key: String): Double {
        val value = json.get(key)
        require(value is Number && value.toDouble().isFinite()) { "滑动参数 $key 必须为有限数值" }
        return value.toDouble()
    }

    /** 时间字段必须是现有范围内的整数，不能靠截断或夹取接受越界输入。 */
    private fun integer(json: JSONObject, key: String, min: Long, max: Long): Long {
        val value = number(json, key)
        require(value >= min && value <= max && value % 1.0 == 0.0) { "滑动参数 $key 必须为 $min–$max 的整数" }
        return value.toLong()
    }

    /** 在控件等待之前验证坐标，避免无效任务仍触发长时间查询。 */
    private fun percent(json: JSONObject): SwipePercent {
        val x = number(json, "x")
        val y = number(json, "y")
        require(x in 0.0..100.0 && y in 0.0..100.0) { "滑动百分比必须为 0–100 的有限数值" }
        return SwipePercent(x, y)
    }

    /** 回执只包含确认完成的实际像素坐标。 */
    private fun pointJson(point: SwipePoint): JSONObject = JSONObject().put("x", point.x).put("y", point.y)
}
