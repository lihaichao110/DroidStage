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
  it('列表单人失败时继续运行，并以部分完成及人数汇总结束', async () => {
    const list: AutomationTask['steps'][number] = {
      id: 'list', type: 'listClick', container: { kind: 'text', value: '列表' }, row: { kind: 'text', value: '用户行' },
      name: { kind: 'text', value: '昵称' }, identity: { kind: 'text', value: '账号' },
      action: { kind: 'text', value: '关注' }, completed: { kind: 'text', value: '已关注' },
      maxScrolls: 1, timeoutMs: 1000
    }
    const request = vi.fn(async (op: string, args: Record<string, unknown>) => {
      if (op === 'scanRows') return ['甲', '乙'].map((name) => ({ name, key: name, hasAction: true, hasCompleted: false }))
      if (op === 'tapRow') return args.key === '甲' ? { ok: false, reason: '状态未变化' } : { ok: true }
      if (op === 'scrollList') return false
      throw new Error(`未知操作：${op}`)
    })
    const session = { agent: () => ({ request }) } as unknown as DeviceSession
    const events: RunEvent[] = []
    await new TaskRunner().run({ version: 1, name: '关注', steps: [list] }, session, (event) => events.push(event))
    expect(request.mock.calls.filter(([op]) => op === 'tapRow')).toHaveLength(2)
    expect(events).toContainEqual(expect.objectContaining({ kind: 'warning', message: '第 1 步：甲 已跳过：状态未变化' }))
    expect(events.at(-1)).toMatchObject({ kind: 'partial', message: '任务部分完成：成功 1，跳过 1，原已完成 0' })
  })

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
    expect(events[0]).toMatchObject({ kind: 'start', message: '第 1 步：打开应用 · 应用包名：com.example.app' })
    expect(events).toContainEqual(expect.objectContaining({ kind: 'step', message: '第 2 步：点击控件 · 文字：继续', stepIndex: 0 }))
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
    expect(events).toContainEqual(expect.objectContaining({ kind: 'step', message: '第 1 步：点击控件 · 文字：继续' }))
    expect(events.at(-1)?.kind).toBe('success')
  })

  it('输入未生效时保留失败步骤并保存现场截图', async () => {
    const request = vi.fn(async () => { throw new Error('输入未生效（资源 ID：test_input）：文本不一致') })
    const session = {
      agent: () => ({ request }), screenshot: vi.fn(async () => Buffer.from('fake png'))
    } as unknown as DeviceSession
    const events: RunEvent[] = []
    const inputTask: AutomationTask = { version: 1, name: '输入核对', steps: [
      { id: 'input', type: 'input', selector: { kind: 'resourceId', value: 'test_input' }, text: '中文abc', timeoutMs: 1000 }
    ] }

    await expect(new TaskRunner().run(inputTask, session, (event) => events.push(event)))
      .rejects.toThrow('第 1 步（输入文本 · 资源 ID：test_input · 5 字）失败：输入未生效')
    expect(request).toHaveBeenCalledWith('input', expect.objectContaining({ text: '中文abc' }), 7000)
    expect(events.at(-1)).toMatchObject({ kind: 'failure', stepIndex: 0 })
    expect((await stat(path.join(events[0].runDir!, 'failure.png'))).size).toBe(8)
    expect(events.every((event) => !event.message.includes('中文abc'))).toBe(true)
  })

  it('步骤失败时停止并保存失败截图', async () => {
    const session = {
      launch: vi.fn(async () => {}),
      agent: () => ({ request: vi.fn(async () => { throw new Error('未找到控件') }) }),
      screenshot: vi.fn(async () => Buffer.from('fake png'))
    } as unknown as DeviceSession
    const events: RunEvent[] = []
    await expect(new TaskRunner().run(task, session, (event) => events.push(event))).rejects.toThrow('第 2 步（点击控件 · 文字：继续）失败：未找到控件')
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
    await expect(new TaskRunner().run(multiStep, session, (event) => events.push(event))).rejects.toThrow('第 3 步（滑动屏幕 · (200, 600) → (200, 400)）失败：滑动失败')
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
  it('外层重复每轮重新判断并执行对应分支，完成后才进入下一步', async () => {
    const order: string[] = []
    const count = vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(1).mockResolvedValueOnce(0)
    const request = vi.fn(async (op: string) => { order.push(op) })
    const session = {
      launch: vi.fn(async () => { order.push('launch') }), count, agent: () => ({ request })
    } as unknown as DeviceSession
    const events: RunEvent[] = []
    await new TaskRunner().run({ version: 1, name: '重复', packageName: 'com.example.app', steps: [
      { ...condition, repeatCount: 3 }, { id: 'after', type: 'key', key: 'home' }
    ] }, session, (event) => events.push(event))
    expect(order).toEqual(['launch', 'swipe', 'tap', 'swipe', 'key'])
    expect(count).toHaveBeenCalledTimes(3)
    expect(events.filter((event) => event.message.includes('次执行') && event.message.includes('第 1/1 次检查')).map((event) => event.message))
      .toEqual(expect.arrayContaining([expect.stringContaining('第 1/3 次执行'), expect.stringContaining('第 2/3 次执行'), expect.stringContaining('第 3/3 次执行')]))
    expect(events.at(-1)?.kind).toBe('success')
  })

  it('每轮独立执行内部重复查找，分支截图不会覆盖其他轮次', async () => {
    const count = vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(1).mockResolvedValueOnce(0).mockResolvedValueOnce(1)
    const session = {
      count, agent: () => ({ request: vi.fn(async () => 'ok') }), screenshot: vi.fn(async () => Buffer.from('fake png'))
    } as unknown as DeviceSession
    const events: RunEvent[] = []
    await new TaskRunner().run({ version: 1, name: '两层重复', steps: [{
      ...condition, mode: 'repeatUntilPresent', repeatCount: 2, maxChecks: 2, intervalMs: 100,
      whenAbsent: [{ id: 'capture-absent', type: 'screenshot' }],
      whenPresent: [{ id: 'capture-present', type: 'screenshot' }]
    }] }, session, (event) => events.push(event))
    expect(count).toHaveBeenCalledTimes(4)
    for (const round of ['001', '002']) {
      expect((await stat(path.join(events[0].runDir!, `step-001-run-${round}-absent-001-001.png`))).size).toBe(8)
      expect((await stat(path.join(events[0].runDir!, `step-001-run-${round}-present-002-001.png`))).size).toBe(8)
    }
    expect(events.filter((event) => event.message.includes('第 2/2 次检查'))).toHaveLength(2)
  })

  it('外层某轮失败时注明轮次并停止后续轮次和步骤', async () => {
    const request = vi.fn().mockResolvedValueOnce('ok').mockRejectedValueOnce(new Error('点击失败'))
    const count = vi.fn(async () => 1)
    const session = {
      count, agent: () => ({ request }), screenshot: vi.fn(async () => Buffer.from('fake png'))
    } as unknown as DeviceSession
    const events: RunEvent[] = []
    await expect(new TaskRunner().run({ version: 1, name: '失败', steps: [
      { ...condition, repeatCount: 3 }, { id: 'after', type: 'key', key: 'home' }
    ] }, session, (event) => events.push(event))).rejects.toThrow('第 2/3 次执行失败')
    expect(request).toHaveBeenCalledTimes(2)
    expect(count).toHaveBeenCalledTimes(2)
    expect(events.at(-1)).toMatchObject({ kind: 'failure', stepIndex: 0 })
  })

  it('取消后不会开始下一轮条件判断', async () => {
    const runner = new TaskRunner()
    const request = vi.fn(async () => { runner.cancel() })
    const count = vi.fn(async () => 1)
    const session = { count, agent: () => ({ request }) } as unknown as DeviceSession
    const events: RunEvent[] = []
    await runner.run({ version: 1, name: '取消', steps: [{ ...condition, repeatCount: 3 }] }, session, (event) => events.push(event))
    expect(count).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledTimes(1)
    expect(events.at(-1)?.kind).toBe('cancelled')
  })

  it.each([
    { count: 1, expected: 'tap' },
    { count: 0, expected: 'swipe' }
  ])('判断一次：匹配 $count 个控件时只执行 $expected 分支', async ({ count, expected }) => {
    const request = vi.fn(async (_op: string) => 'ok')
    const session = { count: vi.fn(async () => count), agent: () => ({ request }) } as unknown as DeviceSession
    const events: RunEvent[] = []
    await new TaskRunner().run({ version: 1, name: '单次', steps: [condition] }, session, (event) => events.push(event))
    expect(request.mock.calls.map(([op]) => op)).toEqual([expected])
    expect(session.count).toHaveBeenCalledWith(condition.selector, 2000)
    expect(events.some((event) => event.message.includes(count === 1 ? '存在时' : '不存在时'))).toBe(true)
    expect(events).toContainEqual(expect.objectContaining({ message: '第 1 步：条件判断 · 文字：关注 · 判断一次', stepIndex: 0 }))
    expect(events).toContainEqual(expect.objectContaining({ message: `第 1 步：条件判断 · 文字：关注 · 判断一次 · 第 1/1 次检查（最多等待 2 秒），匹配 ${count} 个控件`, stepIndex: 0 }))
    expect(events.some((event) => event.message.includes(count === 1 ? '点击控件 · 文字：关注' : '滑动屏幕 · (300, 700) → (300, 300)'))).toBe(true)
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
    expect(count.mock.calls).toEqual([
      [condition.selector, 0],
      [condition.selector, 0],
      [condition.selector, 0]
    ])
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
    await expect(new TaskRunner().run({ version: 1, name: '查询失败', steps: [condition] }, querySession, () => {})).rejects.toThrow('第 1 步（条件判断 · 文字：关注 · 判断一次）失败：设备断开')

    const actionSession = {
      count: vi.fn(async () => 1), agent: () => ({ request: vi.fn(async () => { throw new Error('未找到控件') }) }), screenshot: vi.fn(async () => Buffer.from('fake png'))
    } as unknown as DeviceSession
    await expect(new TaskRunner().run({ version: 1, name: '动作失败', steps: [condition] }, actionSession, () => {})).rejects.toThrow('「存在时」分支第 1 个动作（点击控件 · 文字：关注）失败：未找到控件')
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
