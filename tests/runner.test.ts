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
        { id: 'swipe', type: 'swipe', coordinateMode: 'screenPercent', from: { x: 50, y: 80 }, to: { x: 50, y: 20 }, durationMs: 500 },
        { id: 'key', type: 'key', key: 'back' }
      ]
    }
    const request = vi.fn(async (op: string) => { if (op === 'swipeRelative') throw new Error('滑动失败') })
    const session = {
      launch: vi.fn(async () => {}),
      agent: () => ({ request }),
      screenshot: vi.fn(async () => Buffer.from('fake png'))
    } as unknown as DeviceSession
    const events: RunEvent[] = []
    await expect(new TaskRunner().run(multiStep, session, (event) => events.push(event))).rejects.toThrow('第 3 步（滑动屏幕 · 屏幕比例 · (50%, 80%) → (50%, 20%)）失败：滑动失败')
    expect(events.at(-1)?.stepIndex).toBe(1)
    expect(request).toHaveBeenCalledTimes(2) // swipe 失败后第 3 步不再执行
  })
})
