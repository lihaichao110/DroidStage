/**
 * 步骤草稿纯逻辑：定义编辑草稿结构，并把已保存步骤回填为带默认值的草稿。
 */
import type { Point, Step } from '../../../shared/types'

/** 步骤草稿：单一对象承载全部动作类型的输入，提交时按当前动作取用字段。 */
export type StepDraft = {
  /** 正在修改的步骤 id；新建步骤时为 null。 */
  editingId: string | null
  action: Step['type']
  text: string
  timeoutMs: number
  exists: boolean
  key: 'back' | 'home'
  swipeFrom: Point
  swipeTo: Point
  swipeDurationMs: number
}

/** 新建步骤的初始草稿；滑动默认为向上滑半屏，便于直接微调。 */
export const emptyDraft: StepDraft = {
  editingId: null,
  action: 'tap',
  text: '',
  timeoutMs: 10000,
  exists: true,
  key: 'back',
  swipeFrom: { x: 300, y: 700 },
  swipeTo: { x: 300, y: 300 },
  swipeDurationMs: 500
}

/**
 * 把已保存步骤展开为草稿：相关字段取步骤值，其余回落默认值。
 * @param step 已保存的任务步骤
 * @returns 可整体写入草稿状态的完整对象
 */
export function draftFromStep(step: Step): StepDraft {
  return {
    ...emptyDraft,
    editingId: step.id,
    action: step.type,
    text: step.type === 'input' ? step.text : emptyDraft.text,
    // assert/screenshot/key/条件等步骤没有超时字段，回落默认而不是沿用上一次编辑的残值
    timeoutMs: 'timeoutMs' in step ? step.timeoutMs : emptyDraft.timeoutMs,
    exists: step.type === 'wait' || step.type === 'assert' ? step.exists : emptyDraft.exists,
    key: step.type === 'key' ? step.key : emptyDraft.key,
    swipeFrom: step.type === 'swipe' ? step.from : emptyDraft.swipeFrom,
    swipeTo: step.type === 'swipe' ? step.to : emptyDraft.swipeTo,
    swipeDurationMs: step.type === 'swipe' ? step.durationMs : emptyDraft.swipeDurationMs
  }
}
