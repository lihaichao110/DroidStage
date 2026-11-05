/**
 * 步骤草稿状态：通用动作字段的单一来源，支持局部更新与按已存步骤整体载入。
 */
import { useState } from 'react'
import { draftFromStep, emptyDraft, patchDraft } from '../utils/step-draft'
import type { StepDraft } from '../utils/step-draft'
import type { Step } from '../../../shared/types'

/**
 * 维护当前编辑步骤的草稿，替代原先散落的多份字段 state。
 * 提交成功后保留其他输入，随机停顿恢复默认关闭，便于逐动作明确启用。
 * @returns 草稿对象、局部更新与按步骤整体载入
 */
export function useStepDraft() {
  const [draft, setDraft] = useState<StepDraft>(emptyDraft)

  /** 局部更新字段；切换动作与修改参数共用同一入口。 */
  function update(patch: Partial<StepDraft>): void {
    setDraft((current) => patchDraft(current, patch))
  }

  /** 编辑已保存步骤时整体替换，保证无关字段回落默认值。 */
  function loadStep(step: Step): void {
    setDraft(draftFromStep(step))
  }

  return { draft, update, loadStep }
}
