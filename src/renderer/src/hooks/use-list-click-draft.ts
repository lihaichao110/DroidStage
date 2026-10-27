/**
 * 列表批量步骤草稿：维护六个定位条件和滚动上限。
 */
import { useState } from 'react'
import type { ListClickStep, Selector } from '../../../shared/types'

type Fields = Omit<ListClickStep, 'id' | 'type'>
const empty: Selector = { kind: 'resourceId', value: '' }
const initial: Fields = {
  container: empty, row: empty, name: empty, identity: empty, action: { kind: 'text', value: '关注' },
  completed: { kind: 'text', value: '已关注' }, maxScrolls: 100, timeoutMs: 10000
}

/** 返回可编辑草稿及字段更新、加载和重置操作。 */
export function useListClickDraft() {
  const [value, setValue] = useState<Fields>(initial)
  function update<K extends keyof Fields>(key: K, next: Fields[K]): void { setValue((current) => ({ ...current, [key]: next })) }
  function build(id: string): ListClickStep { return { id, type: 'listClick', ...value } }
  function load(step: ListClickStep): void {
    const { container, row, name, identity, action, completed, maxScrolls, timeoutMs } = step
    setValue({ container, row, name, identity, action, completed, maxScrolls, timeoutMs })
  }
  function reset(): void { setValue(initial) }
  return { value, update, build, load, reset }
}
