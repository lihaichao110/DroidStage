/**
 * 用户行画面比对测试：区分相同、含糊和新候选，避免失败行被重复点击。
 */
import { describe, expect, it } from 'vitest'
import { overlapShift, skippedRowMatch } from '../src/main/row-fingerprint'

describe('用户行画面比对', () => {
  it('相同画面去重，接近画面保守跳过，明显不同才作为新行', () => {
    const sample = (shade: number) => new Uint8Array(48 * 16).fill(shade)
    expect(skippedRowMatch(sample(10), [])).toBe('new')
    expect(skippedRowMatch(sample(10), [sample(10)])).toBe('same')
    expect(skippedRowMatch(sample(18), [sample(10)])).toBe('uncertain')
    expect(skippedRowMatch(sample(30), [sample(10)])).toBe('new')
  })

  it('不同尺寸不能被误判为可比的用户行', () => {
    expect(() => skippedRowMatch(new Uint8Array(2), [new Uint8Array(3)])).toThrow('尺寸不一致')
  })

  it('仅在相邻两屏有唯一、顺序一致的重叠行时推导位移', () => {
    const sample = (shade: number) => new Uint8Array(48 * 16).fill(shade)
    const previous = [{ index: 0, sample: sample(10) }, { index: 1, sample: sample(80) }, { index: 2, sample: sample(130) }]
    expect(overlapShift(previous, [{ index: 0, sample: sample(80) }, { index: 1, sample: sample(130) }])).toBe(1)
    expect(overlapShift(previous, [{ index: 0, sample: sample(25) }])).toBeNull()
    expect(overlapShift(previous, [{ index: 0, sample: sample(130) }, { index: 1, sample: sample(80) }])).toBeNull()
    expect(overlapShift([{ index: 0, sample: sample(10) }, { index: 1, sample: sample(10) }], [{ index: 0, sample: sample(10) }])).toBeNull()
  })
})
