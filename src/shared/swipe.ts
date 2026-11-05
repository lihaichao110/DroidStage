/**
 * 滑动展示文案：统一坐标模式和单位，供普通步骤与条件分支复用。
 */
import type { SwipeStep } from './types'

/**
 * 显式标记模式与单位，防止把百分比误看成像素。
 * @param step 已校验的比例滑动步骤
 * @returns 供流程卡与运行日志展示的摘要
 */
export function swipeDetail(step: SwipeStep): string {
  const path = `(${step.from.x}%, ${step.from.y}%) → (${step.to.x}%, ${step.to.y}%)`
  if (step.coordinateMode === 'screenPercent') return `屏幕比例 · ${path}`
  const selector = step.container
  return `控件内比例 · ${selector.value}${selector.matchIndex ? ` · 第 ${selector.matchIndex} 个` : ''} · ${path}`
}
