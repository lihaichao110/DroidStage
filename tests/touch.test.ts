/**
 * 投屏坐标换算与操控输入校验测试：旋转方向推断、等比缩放、scrcpy 控制消息的参数合法性。
 */
import { describe, expect, it } from 'vitest'
import { controlScroll, controlTouchEvents, currentDeviceSize, frameToPoint } from '../src/shared/touch'
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

describe('controlTouchEvents', () => {
  const frame = { frameWidth: 720, frameHeight: 1600 }

  it('down/up：坐标取整，帧尺寸透传', () => {
    expect(controlTouchEvents({ action: 'down', x: 10.6, y: 20.1, ...frame }))
      .toEqual([{ action: 'down', x: 11, y: 20, ...frame }])
    expect(controlTouchEvents({ action: 'up', x: 3, y: 4, ...frame }))
      .toEqual([{ action: 'up', x: 3, y: 4, ...frame }])
  })

  it('cancel 归一化为 up（scrcpy 客户端不发 CANCEL，统一以抬手收尾）', () => {
    expect(controlTouchEvents({ action: 'cancel', x: 3, y: 4, ...frame }))
      .toEqual([{ action: 'up', x: 3, y: 4, ...frame }])
  })

  it('move：轨迹点逐点取整', () => {
    const events = controlTouchEvents({ action: 'move', points: [{ x: 1.5, y: 2 }, { x: 3, y: 4.5 }], ...frame })
    expect(events).toEqual([
      { action: 'move', x: 2, y: 2, ...frame },
      { action: 'move', x: 3, y: 5, ...frame }
    ])
  })

  it('空轨迹或超量轨迹拒绝', () => {
    expect(() => controlTouchEvents({ action: 'move', points: [], ...frame })).toThrow('轨迹点数量无效')
    const points = Array.from({ length: 65 }, () => ({ x: 1, y: 1 }))
    expect(() => controlTouchEvents({ action: 'move', points, ...frame })).toThrow('轨迹点数量无效')
  })

  it('坐标越界（>10000，与任务校验同上限）拒绝', () => {
    expect(() => controlTouchEvents({ action: 'down', x: 10001, y: 5, ...frame })).toThrow('触摸坐标无效')
    expect(() => controlTouchEvents({ action: 'down', x: Number.NaN, y: 5, ...frame })).toThrow('触摸坐标无效')
  })

  it('帧尺寸非法（0、越界 u16、非整数）拒绝', () => {
    expect(() => controlTouchEvents({ action: 'down', x: 1, y: 1, frameWidth: 0, frameHeight: 100 })).toThrow('投屏帧尺寸无效')
    expect(() => controlTouchEvents({ action: 'down', x: 1, y: 1, frameWidth: 720, frameHeight: 65536 })).toThrow('投屏帧尺寸无效')
    expect(() => controlTouchEvents({ action: 'down', x: 1, y: 1, frameWidth: 720.5, frameHeight: 1600 })).toThrow('投屏帧尺寸无效')
  })

  it('未知动作拒绝', () => {
    expect(() => controlTouchEvents({ action: 'jump', x: 1, y: 1, ...frame } as unknown as TouchInput)).toThrow('未知触摸动作')
  })
})

describe('controlScroll', () => {
  const base = { x: 10.6, y: 20.1, frameWidth: 720, frameHeight: 1600 }

  it('坐标取整，dy 钳制在单条消息的 ±16 格内', () => {
    expect(controlScroll({ ...base, dy: -3 })).toEqual({ x: 11, y: 20, frameWidth: 720, frameHeight: 1600, notches: -3 })
    expect(controlScroll({ ...base, dy: 99 }).notches).toBe(16)
    expect(controlScroll({ ...base, dy: -99 }).notches).toBe(-16)
  })

  it('dy 非有限数或坐标越界拒绝', () => {
    expect(() => controlScroll({ ...base, dy: Number.NaN })).toThrow('滚轮参数无效')
    expect(() => controlScroll({ ...base, dy: 1, x: 10001 })).toThrow('触摸坐标无效')
    expect(() => controlScroll({ ...base, dy: 1, frameWidth: 0 })).toThrow('投屏帧尺寸无效')
  })
})
