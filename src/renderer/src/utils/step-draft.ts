/**
 * 步骤草稿纯逻辑：定义编辑草稿结构，并把已保存步骤回填为带默认值的草稿。
 */
import type { Step } from '../../../shared/types'
import { emptySwipeDraft, swipeDraftFromStep } from './swipe-draft'
import type { SwipeDraft } from './swipe-draft'

/** 步骤草稿：单一对象承载全部动作类型的输入，提交时按当前动作取用字段。 */
export type StepDraft = {
  /** 正在修改的步骤 id；新建步骤时为 null。 */
  editingId: string | null
  action: Step['type']
  text: string
  timeoutMs: number
  hasRandomDelay: boolean
  exists: boolean
  key: 'back' | 'home'
  swipe: SwipeDraft
}

/** 新建步骤的初始草稿；滑动默认为按屏幕比例向上滑动，便于直接微调。 */
export const emptyDraft: StepDraft = {
  editingId: null,
  action: 'tap',
  text: '',
  timeoutMs: 10000,
  hasRandomDelay: false,
  exists: true,
  key: 'back',
  swipe: emptySwipeDraft()
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
    hasRandomDelay: 'hasRandomDelay' in step && step.hasRandomDelay === true,
    text: step.type === 'input' ? step.text : emptyDraft.text,
    // assert/screenshot/key/条件等步骤没有超时字段，回落默认而不是沿用上一次编辑的残值
    timeoutMs: 'timeoutMs' in step && typeof step.timeoutMs === 'number' ? step.timeoutMs : emptyDraft.timeoutMs,
    exists: step.type === 'wait' || step.type === 'assert' ? step.exists : emptyDraft.exists,
    key: step.type === 'key' ? step.key : emptyDraft.key,
    swipe: step.type === 'swipe' ? swipeDraftFromStep(step) : emptySwipeDraft()
  }
}

/**
 * 仅给支持的动作保存随机开关，避免切换动作后把隐藏的勾选状态写入无关步骤。
 * @param step 当前动作构建出的步骤
 * @param hasRandomDelay 是否启用动作前随机停顿
 * @returns 开关关闭时省略可选字段的步骤
 */
export function withRandomDelay<T extends Step>(step: T, hasRandomDelay: boolean): T {
  if (step.type !== 'tap' && step.type !== 'input' && step.type !== 'swipe') return step
  const { hasRandomDelay: _previous, ...base } = step
  return { ...base, ...(hasRandomDelay ? { hasRandomDelay: true } : {}) } as T
}

/**
 * 更新草稿时让新动作恢复默认关闭，防止编辑或连续添加时继承上一动作的勾选。
 * @param current 原草稿
 * @param patch 要修改的字段
 * @returns 保留其他输入的新草稿
 */
export function patchDraft(current: StepDraft, patch: Partial<StepDraft>): StepDraft {
  const isNewAction = patch.editingId === null || patch.action !== undefined && patch.action !== current.action
  return { ...current, hasRandomDelay: isNewAction ? false : current.hasRandomDelay, ...patch }
}
