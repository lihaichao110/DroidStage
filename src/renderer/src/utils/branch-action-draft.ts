/**
 * 分支动作草稿：负责默认参数、已有动作回填与步骤构建，避免表单承担数据转换。
 */
import type { BasicStep, Point, Selector } from '../../../shared/types'
import { buildSwipeStep, emptySwipeDraft, swipeDraftFromStep } from './swipe-draft'
import type { SwipeDraft } from './swipe-draft'
import { withRandomDelay } from './step-draft'

export type ActionDraft = {
  id: string
  type: BasicStep['type']
  selector: Selector | null
  tapTarget: 'selector' | 'point'
  point: Point
  text: string
  timeoutMs: number
  hasRandomDelay: boolean
  swipe: SwipeDraft
  exists: boolean
  key: 'back' | 'home'
}

/** 分支草稿使用已有条件目标，便于把“存在时”直接配置为点击该控件。 */
export function emptyDraft(selector: Selector | null): ActionDraft {
  return {
    id: crypto.randomUUID(), type: 'tap', selector, tapTarget: 'selector', point: { x: 300, y: 500 },
    text: '', timeoutMs: 10000, hasRandomDelay: false, swipe: emptySwipeDraft(), exists: true, key: 'back'
  }
}

/** 从已有动作恢复表单参数，编辑后保留原 ID 与其他分支动作顺序。 */
export function draftFromStep(step: BasicStep): ActionDraft {
  const draft = emptyDraft('selector' in step ? step.selector ?? null : null)
  draft.id = step.id
  draft.type = step.type
  draft.hasRandomDelay = 'hasRandomDelay' in step && step.hasRandomDelay === true
  if (step.type === 'tap') {
    draft.tapTarget = step.point ? 'point' : 'selector'
    draft.point = step.point ?? draft.point
  }
  if ('timeoutMs' in step && typeof step.timeoutMs === 'number') draft.timeoutMs = step.timeoutMs
  if (step.type === 'input') draft.text = step.text
  if (step.type === 'swipe') draft.swipe = swipeDraftFromStep(step)
  if (step.type === 'wait' || step.type === 'assert') draft.exists = step.exists
  if (step.type === 'key') draft.key = step.key
  return draft
}

/** 将表单草稿转成与顶层动作相同的数据结构，仍由共享校验器检查。 */
function buildBaseStep(draft: ActionDraft): BasicStep {
  const { id, type, selector, timeoutMs } = draft
  switch (type) {
    case 'tap': return draft.tapTarget === 'point'
      ? { id, type, point: draft.point, timeoutMs }
      : { id, type, selector: selector ?? undefined, timeoutMs }
    case 'input': return { id, type, selector: selector!, text: draft.text, timeoutMs }
    case 'swipe': return buildSwipeStep(id, draft.swipe)
    case 'wait': return { id, type, selector: selector!, exists: draft.exists, timeoutMs }
    case 'assert': return { id, type, selector: selector!, exists: draft.exists }
    case 'screenshot': return { id, type }
    case 'key': return { id, type, key: draft.key }
  }
}

/**
 * 为分支动作复用顶层步骤的随机配置规则。
 * @param draft 当前分支动作草稿
 * @returns 待任务校验的基础步骤
 */
export function buildStep(draft: ActionDraft): BasicStep {
  return withRandomDelay(buildBaseStep(draft), draft.hasRandomDelay)
}
