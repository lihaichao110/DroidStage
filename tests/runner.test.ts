/**
 * 任务执行器测试：验证普通步骤与条件分支的日志、错误和取消行为。
 */
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AutomationTask, RunEvent } from '../src/shared/types'
import type { DeviceSession } from '../src/main/session'

vi.mock('electron', () => ({ app: { getPath: () => process.env.AAD_TEST_RUN_ROOT } }))
import { TaskRunner } from '../src/main/runner'

let root = ''
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'aad-runner-'))
  process.env.AAD_TEST_RUN_ROOT = root
})
afterEach(async () => {
  if (root.startsWith(os.tmpdir() + path.sep) && path.basename(root).startsWith('aad-runner-')) await rm(root, { recursive: true, force: true })
  delete process.env.AAD_TEST_RUN_ROOT
})

const task: AutomationTask = {
  version: 1, name: '测试', packageName: 'com.example.app',
  steps: [{ id: 'tap', type: 'tap', selector: { kind: 'text', value: '继续' }, timeoutMs: 1000 }]
}

describe('任务执行器', () => {
  it('先启动目标 App，再执行步骤并保存成功日志', async () => {
    const order: string[] = []
    const session = {
      launch: vi.fn(async () => { order.push('launch') }),
      agent: () => ({ request: vi.fn(async () => { order.push('tap') }) })
    } as unknown as DeviceSession
    const events: RunEvent[] = []
    await new TaskRunner().run(task, session, (event) => events.push(event))
    expect(order).toEqual(['launch', 'tap'])
    expect(events.at(-1)?.kind).toBe('success')
    expect(events).toContainEqual(expect.objectContaining({ kind: 'step', message: '第 1 步：点击', stepIndex: 0 }))
    const file = await readFile(path.join(events[0].runDir!, 'events.jsonl'), 'utf8')
    expect(file).toContain('任务执行成功')
  })

  it('未指定包名时不启动 App，步骤直接作用于当前界面', async () => {
    const launch = vi.fn(async () => {})
    const session = {
      launch,
      agent: () => ({ request: vi.fn(async () => {}) })
    } as unknown as DeviceSession
    const events: RunEvent[] = []
    await new TaskRunner().run({ ...task, packageName: undefined }, session, (event) => events.push(event))
    expect(launch).not.toHaveBeenCalled()
    expect(events[0]).toMatchObject({ kind: 'start', message: '未指定目标 App，直接在当前界面执行' })
    expect(events.at(-1)?.kind).toBe('success')
  })

  it('步骤失败时停止并保存失败截图', async () => {
    const session = {
      launch: vi.fn(async () => {}),
      agent: () => ({ request: vi.fn(async () => { throw new Error('未找到控件') }) }),
      screenshot: vi.fn(async () => Buffer.from('fake png'))
    } as unknown as DeviceSession
    const events: RunEvent[] = []
    await expect(new TaskRunner().run(task, session, (event) => events.push(event))).rejects.toThrow('第 1 步（点击）失败：未找到控件')
    expect(events.at(-1)?.kind).toBe('failure')
    expect(events.at(-1)?.stepIndex).toBe(0)
    expect((await stat(path.join(events[0].runDir!, 'failure.png'))).size).toBe(8)
  })

  it('失败消息包含失败步骤的序号与动作名，后续步骤不再执行', async () => {
    const multiStep: AutomationTask = {
      version: 1, name: '多步', packageName: 'com.example.app',
      steps: [
        { id: 'tap', type: 'tap', selector: { kind: 'text', value: '继续' }, timeoutMs: 1000 },
        { id: 'swipe', type: 'swipe', from: { x: 200, y: 600 }, to: { x: 200, y: 400 }, durationMs: 500 },
        { id: 'key', type: 'key', key: 'back' }
      ]
    }
    const request = vi.fn(async (op: string) => { if (op === 'swipe') throw new Error('滑动失败') })
    const session = {
      launch: vi.fn(async () => {}),
      agent: () => ({ request }),
      screenshot: vi.fn(async () => Buffer.from('fake png'))
    } as unknown as DeviceSession
    const events: RunEvent[] = []
    await expect(new TaskRunner().run(multiStep, session, (event) => events.push(event))).rejects.toThrow('第 2 步（滑动）失败：滑动失败')
    expect(events.at(-1)?.stepIndex).toBe(1)
    expect(request).toHaveBeenCalledTimes(2) // swipe 失败后第 3 步不再执行
  })
})

const condition = {
  id: 'condition', type: 'condition' as const, selector: { kind: 'text' as const, value: '关注' },
  mode: 'once' as const,
  whenPresent: [{ id: 'follow', type: 'tap' as const, selector: { kind: 'text' as const, value: '关注' }, timeoutMs: 1000 }],
  whenAbsent: [{ id: 'next', type: 'swipe' as const, from: { x: 300, y: 700 }, to: { x: 300, y: 300 }, durationMs: 500 }]
}

describe('条件判断执行', () => {
  it.each([
    { count: 1, expected: 'tap' },
    { count: 0, expected: 'swipe' }
  ])('判断一次：匹配 $count 个控件时只执行 $expected 分支', async ({ count, expected }) => {
    const request = vi.fn(async (_op: string) => 'ok')
    const session = { count: vi.fn(async () => count), agent: () => ({ request }) } as unknown as DeviceSession
    const events: RunEvent[] = []
    await new TaskRunner().run({ version: 1, name: '单次', steps: [condition] }, session, (event) => events.push(event))
    expect(request.mock.calls.map(([op]) => op)).toEqual([expected])
    expect(events.some((event) => event.message.includes(count === 1 ? '存在时' : '不存在时'))).toBe(true)
    expect(events.at(-1)?.kind).toBe('success')
  })

  it('重复查找：前两次上滑，第三次找到后点击并继续后续步骤', async () => {
    const request = vi.fn(async (_op: string) => 'ok')
    const count = vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(0).mockResolvedValueOnce(1)
    const session = { count, agent: () => ({ request }) } as unknown as DeviceSession
    const events: RunEvent[] = []
    const steps: AutomationTask['steps'] = [
      { ...condition, mode: 'repeatUntilPresent', maxChecks: 3, intervalMs: 100 },
      { id: 'after', type: 'key', key: 'home' }
    ]
    await new TaskRunner().run({ version: 1, name: '循环', steps }, session, (event) => events.push(event))
    expect(count).toHaveBeenCalledTimes(3)
    expect(request.mock.calls.map(([op]) => op)).toEqual(['swipe', 'swipe', 'tap', 'key'])
    expect(events.some((event) => event.message.includes('第 3/3 次检查'))).toBe(true)
  })

  it('按顺序执行多个分支动作，并为不同轮次截图分别命名', async () => {
    const request = vi.fn(async (_op: string) => 'ok')
    const count = vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(0).mockResolvedValueOnce(1)
    const session = {
      count, agent: () => ({ request }), screenshot: vi.fn(async () => Buffer.from('fake png'))
    } as unknown as DeviceSession
    const events: RunEvent[] = []
    const step: AutomationTask['steps'][number] = {
      ...condition, mode: 'repeatUntilPresent', maxChecks: 3, intervalMs: 100,
      whenAbsent: [{ id: 'capture', type: 'screenshot' }, ...condition.whenAbsent],
      whenPresent: [...condition.whenPresent, { id: 'after-follow', type: 'key', key: 'back' }]
    }
    await new TaskRunner().run({ version: 1, name: '多动作', steps: [step] }, session, (event) => events.push(event))
    expect(request.mock.calls.map(([op]) => op)).toEqual(['swipe', 'swipe', 'tap', 'key'])
    const runDir = events[0].runDir!
    expect((await stat(path.join(runDir, 'step-001-absent-001-001.png'))).size).toBe(8)
    expect((await stat(path.join(runDir, 'step-001-absent-002-001.png'))).size).toBe(8)
  })

  it('达到上限后报错，不执行最后一次不存在分支', async () => {
    const request = vi.fn(async (_op: string) => 'ok')
    const session = {
      count: vi.fn(async () => 0), agent: () => ({ request }), screenshot: vi.fn(async () => Buffer.from('fake png'))
    } as unknown as DeviceSession
    const events: RunEvent[] = []
    const steps: AutomationTask['steps'] = [{ ...condition, mode: 'repeatUntilPresent', maxChecks: 2, intervalMs: 100 }]
    await expect(new TaskRunner().run({ version: 1, name: '上限', steps }, session, (event) => events.push(event))).rejects.toThrow('连续检查 2 次仍未找到控件')
    expect(request.mock.calls.map(([op]) => op)).toEqual(['swipe'])
    expect(events.at(-1)?.kind).toBe('failure')
  })

  it.each([
    { count: 2, error: '定位条件匹配 2 个控件' },
    { count: -1, error: '控件匹配数量无效' }
  ])('匹配数量异常时明确失败，不进入任一分支', async ({ count, error }) => {
    const request = vi.fn(async () => 'ok')
    const session = { count: vi.fn(async () => count), agent: () => ({ request }), screenshot: vi.fn(async () => Buffer.from('fake png')) } as unknown as DeviceSession
    await expect(new TaskRunner().run({ version: 1, name: '异常', steps: [condition] }, session, () => {})).rejects.toThrow(error)
    expect(request).not.toHaveBeenCalled()
  })

  it('查询错误和分支动作错误都保留条件步骤上下文', async () => {
    const querySession = {
      count: vi.fn(async () => { throw new Error('设备断开') }), agent: () => ({ request: vi.fn() }), screenshot: vi.fn(async () => Buffer.from('fake png'))
    } as unknown as DeviceSession
    await expect(new TaskRunner().run({ version: 1, name: '查询失败', steps: [condition] }, querySession, () => {})).rejects.toThrow('第 1 步（条件判断）失败：设备断开')

    const actionSession = {
      count: vi.fn(async () => 1), agent: () => ({ request: vi.fn(async () => { throw new Error('未找到控件') }) }), screenshot: vi.fn(async () => Buffer.from('fake png'))
    } as unknown as DeviceSession
    await expect(new TaskRunner().run({ version: 1, name: '动作失败', steps: [condition] }, actionSession, () => {})).rejects.toThrow('「存在时」分支第 1 个动作（点击）失败：未找到控件')
  })

  it('取消重复查找时在下一次检查前停止', async () => {
    const runner = new TaskRunner()
    const request = vi.fn(async () => { runner.cancel(); return 'ok' })
    const count = vi.fn(async () => 0)
    const session = { count, agent: () => ({ request }) } as unknown as DeviceSession
    const events: RunEvent[] = []
    await runner.run({ version: 1, name: '取消', steps: [{ ...condition, mode: 'repeatUntilPresent', maxChecks: 20, intervalMs: 1000 }] }, session, (event) => events.push(event))
    expect(count).toHaveBeenCalledTimes(1)
    expect(events.at(-1)?.kind).toBe('cancelled')
  })
})
