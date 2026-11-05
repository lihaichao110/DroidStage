/**
 * 随机停顿配置测试：覆盖任务校验、普通步骤与分支的保存回填和默认关闭。
 */
import { describe, expect, it } from 'vitest'
import type { BasicStep } from '../src/shared/types'
import { validateTask } from '../src/shared/task-validation'
import { draftFromStep, emptyDraft, patchDraft, withRandomDelay } from '../src/renderer/src/utils/step-draft'
import { buildStep, draftFromStep as branchDraft, emptyDraft as emptyBranch } from '../src/renderer/src/utils/branch-action-draft'

const selector = { kind: 'text' as const, value: '继续' }
const interactions: BasicStep[] = [
  { id: 'tap', type: 'tap', selector, timeoutMs: 1000 },
  { id: 'point', type: 'tap', point: { x: 100, y: 200 }, timeoutMs: 1000 },
  { id: 'input', type: 'input', selector, text: '你好', timeoutMs: 1000 },
  { id: 'screen', type: 'swipe', coordinateMode: 'screenPercent', from: { x: 50, y: 80 }, to: { x: 50, y: 20 }, durationMs: 500 },
  { id: 'element', type: 'swipe', coordinateMode: 'elementPercent', container: selector, timeoutMs: 1000,
    from: { x: 50, y: 80 }, to: { x: 50, y: 20 }, durationMs: 500 }
]
const task = (steps: unknown[]) => ({ version: 1, name: '随机配置', steps })

describe('随机停顿配置', () => {
  it.each(interactions)('$id 旧任务兼容，显式布尔开关合法', (step) => {
    for (const candidate of [step, { ...step, hasRandomDelay: false }, { ...step, hasRandomDelay: true }]) {
      expect(() => validateTask(task([candidate]))).not.toThrow()
    }
    expect(draftFromStep(step).hasRandomDelay).toBe(false)
    expect(branchDraft(step).hasRandomDelay).toBe(false)
  })

  it.each([null, undefined, 1, 0, 'true', {}, []])('拒绝非布尔值 %s，包括分支', (value) => {
    for (const step of interactions) {
      const candidate = { ...step, hasRandomDelay: value }
      expect(() => validateTask(task([candidate]))).toThrow('随机停顿必须为布尔值')
      expect(() => validateTask(task([{ id: 'condition', type: 'condition', mode: 'once', selector,
        whenPresent: [candidate], whenAbsent: [] }]))).toThrow('随机停顿必须为布尔值')
    }
  })

  it.each(['wait', 'assert', 'screenshot', 'key', 'condition', 'listClick'])('%s 不接受随机字段，即使为 false', (type) => {
    expect(() => validateTask(task([{ id: 'unsupported', type, hasRandomDelay: false }]))).toThrow('仅点击、输入和滑动支持随机停顿')
  })

  it.each(interactions)('$id 普通步骤与分支经过保存导入后保留开关，关闭时省略字段', (step) => {
    const saved = withRandomDelay(step, true)
    const imported = JSON.parse(JSON.stringify(saved)) as BasicStep
    validateTask(task([imported]))
    const draft = draftFromStep(imported)
    expect(draft.hasRandomDelay).toBe(true)
    expect(withRandomDelay(imported, draft.hasRandomDelay)).toEqual(saved)
    expect(withRandomDelay(imported, false)).toEqual(step)
    const branch = branchDraft(imported)
    expect(branch.hasRandomDelay).toBe(true)
    expect(buildStep(branch)).toEqual(saved)
    expect(buildStep({ ...branch, hasRandomDelay: false })).toEqual(step)
    expect(() => validateTask(task([{ id: 'condition', type: 'condition', mode: 'once', selector,
      whenPresent: [buildStep(branch)], whenAbsent: [] }]))).not.toThrow()
  })

  it('新建、保存后与切换动作时恢复默认关闭，修改参数时保留勾选', () => {
    expect(emptyDraft.hasRandomDelay).toBe(false)
    expect(emptyBranch(selector).hasRandomDelay).toBe(false)
    const enabled = { ...emptyDraft, editingId: 'editing', hasRandomDelay: true }
    expect(patchDraft(enabled, { editingId: null }).hasRandomDelay).toBe(false)
    expect(patchDraft(enabled, { action: 'swipe' }).hasRandomDelay).toBe(false)
    expect(patchDraft(enabled, { timeoutMs: 2000 }).hasRandomDelay).toBe(true)
  })

  it('切换到无关动作后隐藏的勾选不写入步骤', () => {
    const step: BasicStep = { id: 'key', type: 'key', key: 'back' }
    expect(withRandomDelay(step, true)).toEqual(step)
    const draft = { ...emptyBranch(selector), type: 'wait' as const, hasRandomDelay: true }
    expect(buildStep(draft)).not.toHaveProperty('hasRandomDelay')
  })
})
