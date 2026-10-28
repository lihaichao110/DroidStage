/**
 * 列表批量步骤草稿：切换按身份或按行状态时保留各自的输入。
 */
import { useState } from 'react'
import type { ListClickDraft, ListClickStep, Selector } from '../../../shared/types'
import { buildListStep } from '../../../shared/task'

const empty: Selector = { kind: 'resourceId', value: '' }
const initial: ListClickDraft = {
  mode: 'rowState', container: empty, row: empty, name: empty, identity: empty, action: { kind: 'text', value: '关注' },
  completed: { kind: 'text', value: '已关注' }, maxScrolls: 100, timeoutMs: 10000
}

/** 返回可编辑草稿及字段更新、加载和重置操作。 */
export function useListClickDraft() {
  const [value, setValue] = useState<ListClickDraft>(initial)
  function update<K extends keyof ListClickDraft>(key: K, next: ListClickDraft[K]): void { setValue((current) => ({ ...current, [key]: next })) }
  function build(id: string): ListClickStep { return buildListStep(id, value) }
  function load(step: ListClickStep): void {
    setValue({ mode: step.mode === 'rowState' ? 'rowState' : 'identity', container: step.container, row: step.row,
      name: step.mode === 'rowState' ? empty : step.name, identity: step.mode === 'rowState' ? empty : step.identity,
      action: step.action, completed: step.completed, rowDepth: step.rowDepth,
      maxScrolls: step.maxScrolls, timeoutMs: step.timeoutMs })
  }
  function reset(): void { setValue(initial) }
  return { value, update, build, load, reset }
}
