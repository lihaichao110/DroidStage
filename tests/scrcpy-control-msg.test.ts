/**
 * scrcpy 控制消息编码测试：与 server 端（v5.0.1 ControlMessageReader）逐字节对齐的
 * 黄金字节断言，以及定点数编码的边界钳制。协议无版本兼容承诺，升级 server 时
 * 本文件必须随协议复核更新。
 */
import { describe, expect, it } from 'vitest'
import {
  AKEYCODE_HOME,
  encodeBackClick,
  encodeKeyClick,
  encodeKeycodeEvent,
  encodeScrollEvent,
  encodeTouchEvent
} from '../src/shared/utils/scrcpy-control-msg'

describe('encodeTouchEvent', () => {
  const frame = { frameWidth: 720, frameHeight: 1600 }

  it('down：32 字节，全字段黄金字节（pointer_id=-1，压力满档，左键位）', () => {
    const buffer = encodeTouchEvent({ action: 'down', x: 100, y: 200, ...frame })
    expect(buffer.toString('hex')).toBe('0200ffffffffffffffff00000064000000c802d00640ffff0000000100000001')
  })

  it('move：action=MOVE，action_button 归零，buttons 保持按住', () => {
    const buffer = encodeTouchEvent({ action: 'move', x: 1, y: 2, ...frame })
    expect(buffer.length).toBe(32)
    expect(buffer[1]).toBe(2)
    expect(buffer.readUInt16BE(22)).toBe(0xffff)
    expect(buffer.readUInt32BE(24)).toBe(0)
    expect(buffer.readUInt32BE(28)).toBe(0x1)
  })

  it('up：压力与 buttons 归零，action_button 仍携带左键位', () => {
    const buffer = encodeTouchEvent({ action: 'up', x: 1, y: 2, ...frame })
    expect(buffer[1]).toBe(1)
    expect(buffer.readUInt16BE(22)).toBe(0x0000)
    expect(buffer.readUInt32BE(24)).toBe(0x1)
    expect(buffer.readUInt32BE(28)).toBe(0)
  })

  it('坐标取整后编码', () => {
    const buffer = encodeTouchEvent({ action: 'down', x: 10.6, y: 20.1, ...frame })
    expect(buffer.readInt32BE(10)).toBe(11)
    expect(buffer.readInt32BE(14)).toBe(20)
  })
})

describe('encodeScrollEvent', () => {
  const base = { x: 10, y: 20, frameWidth: 720, frameHeight: 1600 }

  it('21 字节，1 格 = 0x0800（server 端按 i16 定点 ×16 解码）', () => {
    const buffer = encodeScrollEvent({ ...base, notches: 1 })
    // 按协议分段拼期望字节：type=3 | x | y | 帧宽 | 帧高 | hscroll=0 | vscroll=1 格 | buttons=0
    const expected = Buffer.from(['03', '0000000a', '00000014', '02d0', '0640', '0000', '0800', '00000000'].join(''), 'hex')
    expect(buffer.length).toBe(21)
    expect(buffer.equals(expected)).toBe(true)
  })

  it('负向与小数格数（触控板平滑滚动）', () => {
    expect(encodeScrollEvent({ ...base, notches: -3 }).readInt16BE(15)).toBe(-0x1800)
    expect(encodeScrollEvent({ ...base, notches: 0.5 }).readInt16BE(15)).toBe(0x0400)
  })

  it('±16 格为单条消息上限，超出钳制', () => {
    expect(encodeScrollEvent({ ...base, notches: 99 }).readInt16BE(15)).toBe(0x7fff)
    expect(encodeScrollEvent({ ...base, notches: -99 }).readInt16BE(15)).toBe(-0x8000)
  })

  it('水平滚动恒为 0，buttons 恒为 0', () => {
    const buffer = encodeScrollEvent({ ...base, notches: 2 })
    expect(buffer.readInt16BE(13)).toBe(0)
    expect(buffer.readUInt32BE(17)).toBe(0)
  })
})

describe('encodeKeycodeEvent / 组合点击', () => {
  it('HOME 按下：14 字节黄金字节（repeat/meta 恒 0）', () => {
    // 按协议分段拼期望字节：type=0 | action=按下 | keycode=HOME | repeat | meta
    const expected = Buffer.from(['00', '00', '00000003', '00000000', '00000000'].join(''), 'hex')
    const buffer = encodeKeycodeEvent(AKEYCODE_HOME, 0)
    expect(buffer.length).toBe(14)
    expect(buffer.equals(expected)).toBe(true)
  })

  it('HOME 完整点击 = 按下 + 抬起', () => {
    const messages = encodeKeyClick(AKEYCODE_HOME)
    expect(messages).toHaveLength(2)
    expect(messages[1][1]).toBe(1)
    expect(messages[1].readUInt32BE(2)).toBe(AKEYCODE_HOME)
  })

  it('返回键点击 = BACK_OR_SCREEN_ON 按下 + 抬起（各 2 字节）', () => {
    expect(encodeBackClick().map((message) => message.toString('hex'))).toEqual(['0400', '0401'])
  })
})
