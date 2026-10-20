/**
 * 条件步骤草稿状态：在新增与编辑之间恢复两个分支和重试参数。
 */
import { useState } from 'react'
import type { BasicStep, ConditionStep, Selector } from '../../../shared/types'

/**
 * 保存条件步骤的编辑态，并按模式生成兼容旧版任务格式的新步骤。
 * @returns 条件字段、更新函数及新建和恢复操作
 */
export function useConditionDraft() {
  const [mode, setMode] = useState<'once' | 'repeatUntilPresent'>('once')
  const [maxChecks, setMaxChecks] = useState(20)
  const [intervalMs, setIntervalMs] = useState(1000)
  const [whenPresent, setWhenPresent] = useState<BasicStep[]>([])
  const [whenAbsent, setWhenAbsent] = useState<BasicStep[]>([])

  function reset(): void {
    setMode('once')
    setMaxChecks(20)
    setIntervalMs(1000)
    setWhenPresent([])
    setWhenAbsent([])
  }

  function load(step: ConditionStep): void {
    setMode(step.mode)
    setWhenPresent(step.whenPresent)
    setWhenAbsent(step.whenAbsent)
    if (step.mode === 'repeatUntilPresent') { setMaxChecks(step.maxChecks); setIntervalMs(step.intervalMs) }
  }

  function build(id: string, selector: Selector): ConditionStep {
    return mode === 'once'
      ? { id, type: 'condition', selector, mode, whenPresent, whenAbsent }
      : { id, type: 'condition', selector, mode, maxChecks, intervalMs, whenPresent, whenAbsent }
  }

  return { mode, setMode, maxChecks, setMaxChecks, intervalMs, setIntervalMs, whenPresent, setWhenPresent, whenAbsent, setWhenAbsent, reset, load, build }
}
