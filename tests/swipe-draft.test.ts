/**
 * 滑动草稿测试：验证起终点保留、模式切换、定位字段隔离及导入导出回填。
 */
import { describe, expect, it } from 'vitest'
import { buildSwipeStep, emptySwipeDraft, swipeDraftFromStep } from '../src/renderer/src/utils/swipe-draft'
import { validateTask } from '../src/shared/task'
import type { SwipeStep } from '../src/shared/types'

describe('滑动草稿', () => {
  it('新建默认向上按屏幕比例滑动，并生成独立坐标对象', () => {
    const draft = emptySwipeDraft()
    expect(buildSwipeStep('s', draft)).toEqual({ id: 's', type: 'swipe', coordinateMode: 'screenPercent',
      from: { x: 50, y: 80 }, to: { x: 50, y: 20 }, durationMs: 500 })
    draft.from.x = 1
    expect(emptySwipeDraft().from.x).toBe(50)
  })

  it.each([
    ['向上', { x: 50, y: 80 }, { x: 50, y: 20 }],
    ['向下', { x: 50, y: 20 }, { x: 50, y: 80 }],
    ['向左', { x: 80, y: 50 }, { x: 20, y: 50 }],
    ['向右', { x: 20, y: 50 }, { x: 80, y: 50 }],
    ['斜向', { x: 44.5, y: 88 }, { x: 70, y: 21 }]
  ] as const)('%s 路径仅通过起终点保存，回填保持坐标和时长', (_label, from, to) => {
    const step = buildSwipeStep('s', { ...emptySwipeDraft(), from, to, durationMs: 750 })
    const restored = swipeDraftFromStep(step)
    expect(step).toMatchObject({ from, to, durationMs: 750 })
    expect(restored).toMatchObject({ from, to, durationMs: 750 })
    expect(step).not.toHaveProperty('direction')
    expect(buildSwipeStep('s', restored)).toEqual(step)
  })

  it('模式切换保留路径与控件草稿，仅序列化当前模式字段', () => {
    const draft = { ...emptySwipeDraft(), container: { kind: 'resourceId' as const, value: 'list', matchIndex: 2 }, timeoutMs: 3000 }
    const screen = buildSwipeStep('screen', draft)
    const element = buildSwipeStep('element', { ...draft, coordinateMode: 'elementPercent' })
    expect(screen).not.toHaveProperty('container')
    expect(screen).not.toHaveProperty('timeoutMs')
    expect(element).toMatchObject({ container: draft.container, timeoutMs: 3000, from: screen.from, to: screen.to })
    expect(() => buildSwipeStep('bad', { ...emptySwipeDraft(), coordinateMode: 'elementPercent' })).toThrow('控件定位')
  })

  it.each(['screenPercent', 'elementPercent'] as const)('%s 任务导出导入后完整回填', (coordinateMode) => {
    const draft = { ...emptySwipeDraft(), coordinateMode, container: { kind: 'className' as const, value: 'List', matchIndex: 2 }, timeoutMs: 5600 }
    const step = buildSwipeStep('s', draft)
    const imported = JSON.parse(JSON.stringify({ version: 1, name: '比例滑动', steps: [step] }))
    validateTask(imported)
    expect(buildSwipeStep('s', swipeDraftFromStep(imported.steps[0] as SwipeStep))).toEqual(step)
  })
})
