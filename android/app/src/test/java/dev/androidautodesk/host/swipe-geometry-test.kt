/**
 * 比例滑动几何测试：覆盖跨分辨率、偏移区域、屏幕裁剪和退化路径。
 */
package dev.androidautodesk.host

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class SwipeGeometryTest {
    /** 两台不同分辨率设备使用相同百分比，映射到各自屏幕。 */
    @Test fun mapsDifferentScreens() {
        val a = SwipeGeometry.resolve(SwipeDisplay(1080, 2400, 0), null, SwipePercent(50.0, 80.0), SwipePercent(50.0, 20.0))
        val b = SwipeGeometry.resolve(SwipeDisplay(720, 1600, 0), null, SwipePercent(50.0, 80.0), SwipePercent(50.0, 20.0))
        assertEquals(SwipePoint(540, 1919), a.from)
        assertEquals(SwipePoint(540, 480), a.to)
        assertEquals(SwipePoint(360, 1279), b.from)
        assertEquals(SwipePoint(360, 320), b.to)
    }

    /** 百分比包含区域偏移，且 100% 仍在右下排他边界内。 */
    @Test fun mapsOffsetAndEndpoints() {
        val path = SwipeGeometry.resolve(SwipeDisplay(1080, 2400, 0), SwipeBounds(100, 300, 900, 1800),
            SwipePercent(0.0, 0.0), SwipePercent(100.0, 100.0))
        assertEquals(SwipePoint(100, 300), path.from)
        assertEquals(SwipePoint(899, 1799), path.to)
    }

    /** 横屏与部分移出屏幕的控件均以当前可见交集为准。 */
    @Test fun clipsRegionInLandscape() {
        val path = SwipeGeometry.resolve(SwipeDisplay(2400, 1080, 1), SwipeBounds(-100, 200, 2600, 1200),
            SwipePercent(0.0, 0.0), SwipePercent(100.0, 100.0))
        assertEquals(SwipeBounds(0, 200, 2400, 1080), path.bounds)
        assertEquals(SwipePoint(2399, 1079), path.to)
    }

    /** 无效区域和微小距离不得伪装为成功滑动。 */
    @Test fun rejectsInvalidGeometry() {
        val screen = SwipeDisplay(100, 100, 0)
        for (bounds in listOf(SwipeBounds(100, 0, 150, 50), SwipeBounds(5, 5, 5, 20), SwipeBounds(10, 10, 5, 5))) {
            assertThrows(IllegalArgumentException::class.java) { SwipeGeometry.resolve(screen, bounds, SwipePercent(0.0, 0.0), SwipePercent(100.0, 100.0)) }
        }
        assertThrows(IllegalArgumentException::class.java) { SwipeGeometry.resolve(SwipeDisplay(0, 100, 0), null, SwipePercent(0.0, 0.0), SwipePercent(100.0, 100.0)) }
        assertThrows(IllegalArgumentException::class.java) { SwipeGeometry.resolve(screen, null, SwipePercent(50.0, 50.0), SwipePercent(50.01, 50.01)) }
        for (invalid in listOf(-0.1, 100.1, Double.NaN, Double.POSITIVE_INFINITY)) {
            assertThrows(IllegalArgumentException::class.java) { SwipeGeometry.resolve(screen, null, SwipePercent(invalid, 0.0), SwipePercent(100.0, 100.0)) }
        }
    }
}
