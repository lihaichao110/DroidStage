/**
 * 滑动编辑草稿：保存比例坐标与独立控件定位，模式切换时保留已配置路径。
 */
import type { Point, Selector, SwipeStep } from '../../../shared/types'

export type SwipeDraft = {
  coordinateMode: SwipeStep['coordinateMode']
  from: Point
  to: Point
  durationMs: number
  container: Selector | null
  timeoutMs: number
}

/**
 * 新动作使用屏幕比例，默认向上滑动且避开屏幕边缘。
 * @returns 不与其他编辑器共享坐标对象的初始草稿
 */
export function emptySwipeDraft(): SwipeDraft {
  return {
    coordinateMode: 'screenPercent', from: { x: 50, y: 80 }, to: { x: 50, y: 20 },
    durationMs: 500, container: null, timeoutMs: 10000
  }
}

/**
 * 从已校验步骤回填模式、比例路径和控件定位。
 * @param step 已保存的比例滑动步骤
 * @returns 保留定位及查找超时的可编辑草稿
 */
export function swipeDraftFromStep(step: SwipeStep): SwipeDraft {
  const draft = emptySwipeDraft()
  draft.coordinateMode = step.coordinateMode
  draft.durationMs = step.durationMs
  draft.from = { ...step.from }
  draft.to = { ...step.to }
  if (step.coordinateMode === 'elementPercent') {
    draft.container = { ...step.container }
    draft.timeoutMs = step.timeoutMs
  }
  return draft
}

/**
 * 只写当前模式使用的字段；缺少控件时明确报错而不回退到屏幕。
 * @param id 步骤标识
 * @param draft 当前滑动草稿
 * @returns 待共享校验器检查的任务步骤
 * @throws 控件模式未填写区域时抛出
 */
export function buildSwipeStep(id: string, draft: SwipeDraft): SwipeStep {
  const { coordinateMode, durationMs } = draft
  const from = { ...draft.from }
  const to = { ...draft.to }
  if (coordinateMode === 'elementPercent') {
    if (!draft.container) throw new Error('请配置滑动区域的控件定位条件')
    return { id, type: 'swipe', coordinateMode, from, to, durationMs, container: { ...draft.container }, timeoutMs: draft.timeoutMs }
  }
  return { id, type: 'swipe', coordinateMode, from, to, durationMs }
}
