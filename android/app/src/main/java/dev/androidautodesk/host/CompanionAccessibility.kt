/**
 * 无障碍入口：保存系统绑定的服务实例，供独立网络代理执行界面操作。
 */
package dev.androidautodesk.host

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityEvent

class CompanionAccessibility : AccessibilityService() {
    companion object { @Volatile var current: CompanionAccessibility? = null; private set }

    override fun onServiceConnected() { super.onServiceConnected(); current = this }
    override fun onAccessibilityEvent(event: AccessibilityEvent?) {}
    override fun onInterrupt() {}
    override fun onDestroy() { current = null; super.onDestroy() }
}
