/**
 * 动作随机停顿测试：用虚拟时钟验证发令顺序、取消、独立抽样及原时间参数。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AutomationTask, BasicStep, RunEvent } from '../src/shared/types'
import type { DeviceSessionPort } from '../src/main/session-port'

vi.mock('electron', () => ({ app: { getPath: () => '/test-data' } }))
vi.mock('node:fs/promises', () => ({ appendFile: vi.fn(), mkdir: vi.fn(), writeFile: vi.fn() }))
import { TaskRunner } from '../src/main/runner'

const selector = { kind: 'text' as const, value: '继续' }
const tap: BasicStep = { id: 'tap', type: 'tap', selector, timeoutMs: 1000, hasRandomDelay: true }
const swipe: BasicStep = { id: 'swipe', type: 'swipe', coordinateMode: 'screenPercent',
  from: { x: 50, y: 80 }, to: { x: 50, y: 20 }, durationMs: 500, hasRandomDelay: true }
const swipeResult = { bounds: { left: 0, top: 0, right: 100, bottom: 100 }, from: { x: 50, y: 80 }, to: { x: 50, y: 20 } }

/** 只模拟设备回执，虚拟时钟仍驱动真正的执行器与可取消等待。 */
function setup(steps: AutomationTask['steps']) {
  const request = vi.fn(async () => swipeResult)
  const session = { agent: () => ({ request }), count: vi.fn(async () => 1) } as unknown as DeviceSessionPort
  const events: RunEvent[] = []
  const runner = new TaskRunner()
  const running = runner.run({ version: 1, name: '随机节奏', steps }, session, (event) => events.push(event))
  return { request, events, runner, running }
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0) })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('动作前随机停顿', () => {
  it.each([{ random: 0, delay: 50 }, { random: 0.999999, delay: 200 }])('包含边界 $delay 毫秒且到期前不发命令', async ({ random, delay }) => {
    vi.spyOn(Math, 'random').mockReturnValue(random)
    const { request, events, running } = setup([tap])
    await vi.advanceTimersByTimeAsync(delay - 1)
    expect(request).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await running
    expect(request).toHaveBeenCalledWith('tap', { selector, point: undefined, timeoutMs: 1000 }, 4000)
    expect(events).toContainEqual(expect.objectContaining({ stepIndex: 0, message: `第 1 步：动作前随机停顿 ${delay} 毫秒` }))
    expect(events.at(-1)?.kind).toBe('success')
  })

  it.each([undefined, false])('缺省或关闭（%s）时不抽样、不等待', async (hasRandomDelay) => {
    const random = vi.spyOn(Math, 'random')
    const { hasRandomDelay: _enabled, ...legacy } = tap
    const { running, request, events } = setup([hasRandomDelay === undefined ? legacy : { ...legacy, hasRandomDelay }])
    await running
    expect(random).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    expect(request).toHaveBeenCalledTimes(1)
    expect(events.some((event) => event.message.includes('随机停顿'))).toBe(false)
  })

  it('等待期间取消后不发送动作，也不执行后续步骤', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999999)
    const { runner, running, request, events } = setup([tap, { id: 'after', type: 'key', key: 'home' }])
    await vi.advanceTimersByTimeAsync(50)
    runner.cancel()
    await vi.advanceTimersByTimeAsync(50)
    await running
    expect(request).not.toHaveBeenCalled()
    expect(events.at(-1)?.kind).toBe('cancelled')
    expect(Date.now()).toBe(100)
  })

  it('输入与两种滑动模式保留原超时、手势时长与通信预算', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const { request, running } = setup([
      { id: 'input', type: 'input', selector, text: '内容', timeoutMs: 60000, hasRandomDelay: true },
      { ...swipe, durationMs: 10000 },
      { ...swipe, id: 'element', coordinateMode: 'elementPercent', container: selector, timeoutMs: 60000 }
    ])
    await vi.advanceTimersByTimeAsync(150)
    await running
    expect(request).toHaveBeenNthCalledWith(1, 'input', { selector, text: '内容', timeoutMs: 60000 }, 66000)
    expect(request).toHaveBeenNthCalledWith(2, 'swipeRelative', {
      coordinateMode: 'screenPercent', from: swipe.from, to: swipe.to, durationMs: 10000
    }, 15000)
    expect(request).toHaveBeenNthCalledWith(3, 'swipeRelative', {
      coordinateMode: 'elementPercent', from: swipe.from, to: swipe.to, durationMs: 500, container: selector, timeoutMs: 60000
    }, 65500)
  })

  it('条件分支每轮重新抽样，并保留轮次与分支日志上下文', async () => {
    const random = vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0.999999)
    const { request, running, events } = setup([{
      id: 'condition', type: 'condition', mode: 'once', selector, repeatCount: 2, whenPresent: [tap], whenAbsent: []
    }])
    await vi.advanceTimersByTimeAsync(50)
    expect(request).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(199)
    expect(request).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await running
    expect(request).toHaveBeenCalledTimes(2)
    expect(random).toHaveBeenCalledTimes(2)
    expect(events.filter((event) => event.message.includes('随机停顿')).map((event) => event.message)).toEqual([
      '第 1 步 · 第 1/2 次执行「存在时」第 1 个动作：动作前随机停顿 50 毫秒',
      '第 1 步 · 第 2/2 次执行「存在时」第 1 个动作：动作前随机停顿 200 毫秒'
    ])
  })

  it('多设备执行各自抽样', async () => {
    const random = vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0.999999)
    const first = setup([tap])
    const second = setup([tap])
    await vi.advanceTimersByTimeAsync(50)
    expect(first.request).toHaveBeenCalledTimes(1)
    expect(second.request).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(150)
    await Promise.all([first.running, second.running])
    expect(second.request).toHaveBeenCalledTimes(1)
    expect(random).toHaveBeenCalledTimes(2)
  })
})
