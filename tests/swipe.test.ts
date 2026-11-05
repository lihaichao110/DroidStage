/**
 * 滑动文案测试：明确区分屏幕与控件内百分比，并展示匹配序号。
 */
import { describe, expect, it } from 'vitest'
import { swipeDetail } from '../src/shared/swipe'

const base = { id: 's', type: 'swipe' as const, from: { x: 50, y: 80 }, to: { x: 50, y: 20 }, durationMs: 500 }
describe('滑动摘要', () => {
  it('为屏幕路径显示百分比单位', () => {
    expect(swipeDetail({ ...base, coordinateMode: 'screenPercent' })).toBe('屏幕比例 · (50%, 80%) → (50%, 20%)')
  })
  it('为控件路径显示区域定位及序号', () => {
    expect(swipeDetail({ ...base, coordinateMode: 'elementPercent', container: { kind: 'resourceId', value: 'app:id/list', matchIndex: 2 }, timeoutMs: 10000 }))
      .toBe('控件内比例 · app:id/list · 第 2 个 · (50%, 80%) → (50%, 20%)')
  })
})
