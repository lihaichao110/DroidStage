import { describe, expect, it } from 'vitest'
import { draftFromStep, emptyDraft } from '../src/renderer/src/utils/step-draft'
import type { Step } from '../src/shared/types'

const selector = { kind: 'resourceId' as const, value: 'btn' }

/** 造一个带重试参数的条件步骤，验证草稿只记录动作与 id、不吞并条件专属字段。 */
function makeCondition(): Step {
  return { id: 's6', type: 'condition', selector, mode: 'repeatUntilPresent', repeatCount: 2, maxChecks: 5, intervalMs: 500, whenPresent: [], whenAbsent: [] }
}

describe('步骤草稿回填', () => {
  it('无参数步骤只记录 id 与动作，其余字段回落默认值', () => {
    expect(draftFromStep({ id: 's1', type: 'screenshot' })).toEqual({ ...emptyDraft, editingId: 's1', action: 'screenshot' })
  })

  it('输入步骤回填文本与超时', () => {
    const draft = draftFromStep({ id: 's2', type: 'input', selector, text: '你好', timeoutMs: 3000 })
    expect(draft.text).toBe('你好')
    expect(draft.timeoutMs).toBe(3000)
  })

  it('等待步骤回填存在性与超时', () => {
    const draft = draftFromStep({ id: 's3', type: 'wait', selector, exists: false, timeoutMs: 8000 })
    expect(draft.exists).toBe(false)
    expect(draft.timeoutMs).toBe(8000)
  })

  it('断言步骤回填存在性，缺失的超时回落默认', () => {
    const draft = draftFromStep({ id: 's4', type: 'assert', selector, exists: false })
    expect(draft.exists).toBe(false)
    expect(draft.timeoutMs).toBe(emptyDraft.timeoutMs)
  })

  it('滑动步骤回填起终点与时长，按键回落默认', () => {
    const draft = draftFromStep({ id: 's5', type: 'swipe', from: { x: 1, y: 2 }, to: { x: 3, y: 4 }, durationMs: 900 })
    expect(draft.swipeFrom).toEqual({ x: 1, y: 2 })
    expect(draft.swipeTo).toEqual({ x: 3, y: 4 })
    expect(draft.swipeDurationMs).toBe(900)
    expect(draft.key).toBe(emptyDraft.key)
  })

  it('按键步骤回填键值', () => {
    expect(draftFromStep({ id: 's6', type: 'key', key: 'home' }).key).toBe('home')
  })

  it('条件与列表步骤仅记录动作与 id；列表自身的超时照常回填', () => {
    const condition = draftFromStep(makeCondition())
    expect(condition.action).toBe('condition')
    expect(condition.editingId).toBe('s6')
    expect(condition.exists).toBe(emptyDraft.exists)
    const list = draftFromStep({ id: 's7', type: 'listClick', mode: 'identity', container: selector, row: selector, action: selector, completed: selector, name: selector, identity: selector, maxScrolls: 10, timeoutMs: 9000 })
    expect(list.action).toBe('listClick')
    expect(list.timeoutMs).toBe(9000)
  })
})
