/**
 * 比例滑动集成测试：验证顶层与条件分支均记录实际路径，失败时停止后续动作。
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeviceSessionPort } from '../src/main/session-port'
import type { AutomationTask, RunEvent, SwipeStep } from '../src/shared/types'

vi.mock('electron', () => ({ app: { getPath: () => process.env.AAD_TEST_SWIPE_ROOT } }))
import { TaskRunner } from '../src/main/runner'

let root = ''
beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), 'aad-swipe-')); process.env.AAD_TEST_SWIPE_ROOT = root })
afterEach(async () => {
  if (root.startsWith(os.tmpdir() + path.sep) && path.basename(root).startsWith('aad-swipe-')) await rm(root, { recursive: true, force: true })
  delete process.env.AAD_TEST_SWIPE_ROOT
})
const swipe: SwipeStep = { id: 'swipe', type: 'swipe', coordinateMode: 'elementPercent', from: { x: 50, y: 80 }, to: { x: 50, y: 20 },
  durationMs: 500, container: { kind: 'resourceId', value: 'app:id/list' }, timeoutMs: 3000 }
const result = { bounds: { left: 0, top: 300, right: 1080, bottom: 2100 }, from: { x: 540, y: 1739 }, to: { x: 540, y: 660 } }

describe('任务中的比例滑动', () => {
  it.each([false, true])('记录实际坐标到事件与落盘日志，条件分支=%s', async (inBranch) => {
    const request = vi.fn().mockResolvedValue(result)
    const session = { agent: () => ({ request }), count: vi.fn(async () => 0) } as unknown as DeviceSessionPort
    const task: AutomationTask = { version: 1, name: '滑动', steps: inBranch ? [{ id: 'condition', type: 'condition', mode: 'once',
      selector: { kind: 'text', value: '下一页' }, whenPresent: [], whenAbsent: [swipe] }] : [swipe] }
    const events: RunEvent[] = []
    await new TaskRunner().run(task, session, (event) => events.push(event))
    expect(request).toHaveBeenCalledWith('swipeRelative', expect.objectContaining({ container: swipe.container }), 8500)
    const actual = events.find((event) => event.message.includes('实际滑动区域'))!
    expect(actual.message).toContain('像素 (540, 1739) → (540, 660)')
    if (inBranch) expect(actual.message).toContain('「不存在时」第 1 个动作')
    expect(await readFile(path.join(events[0].runDir!, 'events.jsonl'), 'utf8')).toContain(actual.message)
    expect(events.at(-1)?.kind).toBe('success')
  })

  it('滑动失败保留分支上下文并停止后续动作', async () => {
    const request = vi.fn().mockRejectedValue(new Error('滑动区域当前不可见'))
    const session = { agent: () => ({ request }), count: vi.fn(async () => 0), screenshot: vi.fn(async () => Buffer.from('png')) } as unknown as DeviceSessionPort
    const events: RunEvent[] = []
    await expect(new TaskRunner().run({ version: 1, name: '失败', steps: [{ id: 'c', type: 'condition', mode: 'once',
      selector: { kind: 'text', value: '目标' }, whenPresent: [], whenAbsent: [swipe, { id: 'after', type: 'key', key: 'home' }] }] }, session,
    (event) => events.push(event))).rejects.toThrow('「不存在时」分支第 1 个动作')
    expect(request).toHaveBeenCalledTimes(1)
    expect(events.at(-1)).toMatchObject({ kind: 'failure', stepIndex: 0 })
  })
})
