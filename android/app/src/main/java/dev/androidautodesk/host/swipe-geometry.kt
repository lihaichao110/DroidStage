/**
 * 比例滑动几何：使用当前显示区域裁剪目标边界，并将百分比映射到有效像素。
 */
package dev.androidautodesk.host

import kotlin.math.roundToInt

internal data class SwipePoint(val x: Int, val y: Int)
internal data class SwipePercent(val x: Double, val y: Double)
internal data class SwipeBounds(val left: Int, val top: Int, val right: Int, val bottom: Int)
internal data class SwipeDisplay(val width: Int, val height: Int, val rotation: Int)
internal data class SwipePath(val bounds: SwipeBounds, val from: SwipePoint, val to: SwipePoint)

internal object SwipeGeometry {
    /**
     * 解析屏幕或控件内的相对路径；右、下边界为排他边界。
     * @param display 当前方向的完整屏幕像素尺寸
     * @param target 目标控件边界；为空表示整个屏幕
     * @param from 起点百分比
     * @param to 终点百分比
     * @return 裁剪后的区域与实际像素路径
     * @throws IllegalArgumentException 区域无效、比例越界或路径退化时抛出
     */
    fun resolve(display: SwipeDisplay, target: SwipeBounds?, from: SwipePercent, to: SwipePercent): SwipePath {
        require(display.width > 0 && display.height > 0) { "无法读取有效的屏幕尺寸" }
        val screen = SwipeBounds(0, 0, display.width, display.height)
        val region = target?.let {
            SwipeBounds(maxOf(0, it.left), maxOf(0, it.top), minOf(display.width, it.right), minOf(display.height, it.bottom))
        } ?: screen
        require(region.right > region.left && region.bottom > region.top) { "滑动区域在屏幕内不可见或尺寸无效" }
        val start = point(region, from)
        val end = point(region, to)
        require(start != end) { "换算后的滑动起点与终点重合，请增大滑动距离" }
        return SwipePath(region, start, end)
    }

    /** 百分比映射到最后一个有效像素，防止填写 100% 时落到区域外。 */
    private fun point(bounds: SwipeBounds, percent: SwipePercent): SwipePoint {
        require(listOf(percent.x, percent.y).all { it.isFinite() && it in 0.0..100.0 }) { "滑动百分比必须为 0–100 的有限数值" }
        return SwipePoint(bounds.left + ((bounds.right - bounds.left - 1) * percent.x / 100).roundToInt(),
            bounds.top + ((bounds.bottom - bounds.top - 1) * percent.y / 100).roundToInt())
    }
}
