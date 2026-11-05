/**
 * 条件步骤草稿状态：在新增与编辑之间恢复两个分支和重试参数。
 */
import { useState } from 'react'
import type { BasicStep, ConditionStep, Selector } from '../../../shared/types'

/** 条件草稿：同时保留两种判断模式的输入，生成步骤时按当前模式取用。 */
export type ConditionDraft = {
  mode: 'once' | 'repeatUntilPresent'
  repeatCount: number
  maxChecks: number
  intervalMs: number
  whenPresent: BasicStep[]
  whenAbsent: BasicStep[]
}

const initial: ConditionDraft = { mode: 'once', repeatCount: 1, maxChecks: 20, intervalMs: 1000, whenPresent: [], whenAbsent: [] }

/**
 * 保存条件步骤的编辑态，并按模式生成兼容旧版任务格式的新步骤。
 * @returns 条件草稿、局部更新、载入与重置操作及步骤生成函数
 */
export function useConditionDraft() {
  const [value, setValue] = useState<ConditionDraft>(initial)

  function update(patch: Partial<ConditionDraft>): void {
    setValue((current) => ({ ...current, ...patch }))
  }

  function reset(): void {
    setValue(initial)
  }

  function load(step: ConditionStep): void {
    setValue({
      mode: step.mode,
      repeatCount: step.repeatCount ?? 1,
      // 一次性判断没有重试参数，回落默认值，避免沿用上一次编辑的残值
      maxChecks: step.mode === 'repeatUntilPresent' ? step.maxChecks : initial.maxChecks,
      intervalMs: step.mode === 'repeatUntilPresent' ? step.intervalMs : initial.intervalMs,
      whenPresent: step.whenPresent,
      whenAbsent: step.whenAbsent
    })
  }

  function build(id: string, selector: Selector): ConditionStep {
    const { mode, repeatCount, maxChecks, intervalMs, whenPresent, whenAbsent } = value
    return mode === 'once'
      ? { id, type: 'condition', selector, mode, repeatCount, whenPresent, whenAbsent }
      : { id, type: 'condition', selector, mode, repeatCount, maxChecks, intervalMs, whenPresent, whenAbsent }
  }

  return { value, update, load, reset, build }
}
