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
