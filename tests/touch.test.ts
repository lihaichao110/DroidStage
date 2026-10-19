/**
 * 投屏坐标换算与触摸输入校验测试：旋转方向推断、等比缩放、参数合法性。
 */
import { describe, expect, it } from 'vitest'
import { currentDeviceSize, frameToPoint, touchArgs } from '../src/shared/touch'
import type { TouchInput } from '../src/shared/types'

describe('currentDeviceSize', () => {
  it('竖屏物理 + 竖屏帧：保持原尺寸', () => {
    expect(currentDeviceSize({ width: 1080, height: 2400 }, { width: 720, height: 1600 })).toEqual({ width: 1080, height: 2400 })
  })

  it('竖屏物理 + 横屏帧（旋转 90°）：宽高互换', () => {
    expect(currentDeviceSize({ width: 1080, height: 2400 }, { width: 1600, height: 720 })).toEqual({ width: 2400, height: 1080 })
  })

  it('横屏物理 + 竖屏帧：宽高互换', () => {
    expect(currentDeviceSize({ width: 2400, height: 1080 }, { width: 720, height: 1600 })).toEqual({ width: 1080, height: 2400 })
  })
})

describe('frameToPoint', () => {
  const frame = { width: 720, height: 1600 }
  const device = { width: 1080, height: 2400 }

  it('按帧/设备比例等比放大', () => {
    expect(frameToPoint(360, 800, frame, device)).toEqual({ x: 540, y: 1200 })
    expect(frameToPoint(0, 0, frame, device)).toEqual({ x: 0, y: 0 })
  })

  it('越界坐标夹取在屏幕范围内', () => {
    expect(frameToPoint(-30, -30, frame, device)).toEqual({ x: 0, y: 0 })
    expect(frameToPoint(9999, 9999, frame, device)).toEqual({ x: 1079, y: 2399 })
  })

  it('尺寸非正时抛出', () => {
    expect(() => frameToPoint(1, 1, { width: 0, height: 100 }, device)).toThrow('投屏画面尺寸无效')
  })
})

describe('touchArgs', () => {
  it('down/up/cancel：坐标取整透传', () => {
    expect(touchArgs({ action: 'down', x: 10.6, y: 20.1 })).toEqual({ action: 'down', x: 11, y: 20 })
    expect(touchArgs({ action: 'up', x: 3, y: 4 })).toEqual({ action: 'up', x: 3, y: 4 })
    expect(touchArgs({ action: 'cancel', x: 3, y: 4 })).toEqual({ action: 'cancel', x: 3, y: 4 })
  })

  it('move：轨迹点整组透传', () => {
    const args = touchArgs({ action: 'move', points: [{ x: 1.5, y: 2 }, { x: 3, y: 4.5 }] })
    expect(args).toEqual({ action: 'move', points: [{ x: 2, y: 2 }, { x: 3, y: 5 }] })
  })

  it('空轨迹或超量轨迹拒绝', () => {
    expect(() => touchArgs({ action: 'move', points: [] })).toThrow('轨迹点数量无效')
    const points = Array.from({ length: 65 }, () => ({ x: 1, y: 1 }))
    expect(() => touchArgs({ action: 'move', points })).toThrow('轨迹点数量无效')
  })

  it('坐标越界（>10000，与任务校验同上限）拒绝', () => {
    expect(() => touchArgs({ action: 'down', x: 10001, y: 5 })).toThrow('触摸坐标无效')
    expect(() => touchArgs({ action: 'down', x: Number.NaN, y: 5 })).toThrow('触摸坐标无效')
  })

  it('未知动作拒绝', () => {
    expect(() => touchArgs({ action: 'jump', x: 1, y: 1 } as unknown as TouchInput)).toThrow('未知触摸动作')
  })
})
