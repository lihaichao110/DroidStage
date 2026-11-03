/**
 * 批次协调测试：验证设备间失败隔离与逐台取消。
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AutomationTask, RunEvent } from '../src/shared/types'
import type { DeviceRegistry } from '../src/main/device-registry'
import type { DeviceSession } from '../src/main/session'

vi.mock('electron', () => ({ app: { getPath: () => process.env.AAD_TEST_BATCH_ROOT } }))
vi.mock('../src/main/adb', () => ({ listDevices: vi.fn() }))
import { listDevices } from '../src/main/adb'
import { BatchCoordinator } from '../src/main/batch-coordinator'

let root = ''
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'aad-batch-'))
  process.env.AAD_TEST_BATCH_ROOT = root
  vi.mocked(listDevices).mockResolvedValue([
    { serial: 'one', state: 'device', usb: true }, { serial: 'two', state: 'device', usb: true }
  ])
})
afterEach(async () => {
  if (root.startsWith(os.tmpdir() + path.sep) && path.basename(root).startsWith('aad-batch-')) await rm(root, { recursive: true, force: true })
  delete process.env.AAD_TEST_BATCH_ROOT
})

const task: AutomationTask = { version: 1, name: '并行任务', steps: [
  { id: 'a', type: 'key', key: 'home' }, { id: 'b', type: 'key', key: 'back' }
] }

function registry(sessions: Record<string, DeviceSession>): DeviceRegistry {
  return { require(serial: string) { const session = sessions[serial]; if (!session) throw new Error('未连接'); return session } } as unknown as DeviceRegistry
}

async function waitFinished(batch: BatchCoordinator): Promise<void> {
  await vi.waitFor(() => expect(batch.state()?.finishedAt).toBeTruthy(), { timeout: 3000 })
}

describe('多设备批次', () => {
  it('一台失败时另一台继续完成，并按设备保存结果', async () => {
    const one = { agent: () => ({ request: vi.fn(async () => { throw new Error('设备异常') }) }), screenshot: vi.fn(async () => Buffer.from('png')) } as unknown as DeviceSession
    const twoRequest = vi.fn(async () => {})
    const two = { agent: () => ({ request: twoRequest }) } as unknown as DeviceSession
    const events: RunEvent[] = []
    const coordinator = new BatchCoordinator(registry({ one, two }), (event) => events.push(event))
    const started = await coordinator.start(task, ['one', 'two'])
    await waitFinished(coordinator)
    expect(coordinator.state()?.devices.map((device) => device.status)).toEqual(['failure', 'success'])
    expect(coordinator.summary()).not.toHaveProperty('events')
    expect(twoRequest).toHaveBeenCalledTimes(2)
    expect(events.every((event) => event.batchId === started.id && Boolean(event.serial))).toBe(true)
    expect(started.devices[0].runDir).not.toBe(started.devices[1].runDir)
    const history = await coordinator.history()
    expect(history[0].id).toBe(started.id)
  })

  it('取消单台设备不影响同批次其他设备', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    const request = vi.fn(async () => gate)
    const session = { agent: () => ({ request }) } as unknown as DeviceSession
    const coordinator = new BatchCoordinator(registry({ one: session, two: session }), () => {})
    await coordinator.start(task, ['one', 'two'])
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2))
    coordinator.cancel('one')
    release()
    await waitFinished(coordinator)
    expect(coordinator.state()?.devices.map((device) => device.status)).toEqual(['cancelled', 'success'])
    expect(request).toHaveBeenCalledTimes(3)
  })

  it('三十台并行时取消其中一台，其余设备继续完成', async () => {
    const serials = Array.from({ length: 30 }, (_, index) => `device-${index}`)
    vi.mocked(listDevices).mockResolvedValue(serials.map((serial) => ({ serial, state: 'device', usb: true })))
    let release = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    const sessions = Object.fromEntries(serials.map((serial) => [serial, { agent: () => ({ request: async () => gate }) }])) as unknown as Record<string, DeviceSession>
    const coordinator = new BatchCoordinator(registry(sessions), () => {})
    await coordinator.start(task, serials)
    coordinator.cancel('device-17')
    release()
    await waitFinished(coordinator)
    expect(coordinator.state()?.devices.find((device) => device.serial === 'device-17')?.status).toBe('cancelled')
    expect(coordinator.state()?.devices.filter((device) => device.status === 'success')).toHaveLength(29)
  })

  it('目标离线时拒绝启动整个批次', async () => {
    vi.mocked(listDevices).mockResolvedValue([{ serial: 'one', state: 'device', usb: true }])
    const session = { agent: () => ({ request: vi.fn(async () => {}) }) } as unknown as DeviceSession
    const coordinator = new BatchCoordinator(registry({ one: session, two: session }), () => {})
    await expect(coordinator.start(task, ['one', 'two'])).rejects.toThrow('设备 two 已离线')
    expect(coordinator.state()).toBeNull()
  })

  it('纯手机端直连批次无需 ADB 也能执行', async () => {
    vi.mocked(listDevices).mockClear()
    vi.mocked(listDevices).mockRejectedValue(new Error('ADB 不可用'))
    const request = vi.fn(async () => {})
    const session = { agent: () => ({ request }) } as unknown as DeviceSession
    const serial = 'direct:test-device'
    const coordinator = new BatchCoordinator(registry({ [serial]: session }), () => {})
    await coordinator.start(task, [serial])
    await waitFinished(coordinator)
    expect(coordinator.state()?.devices[0].status).toBe('success')
    expect(request).toHaveBeenCalledTimes(2)
    expect(listDevices).not.toHaveBeenCalled()
  })

  it('设备预检期间拒绝第二个批次', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    vi.mocked(listDevices).mockImplementationOnce(async () => { await gate; return [{ serial: 'one', state: 'device', usb: true }] })
    const session = { agent: () => ({ request: vi.fn(async () => {}) }) } as unknown as DeviceSession
    const coordinator = new BatchCoordinator(registry({ one: session }), () => {})
    const first = coordinator.start(task, ['one'])
    await expect(coordinator.start(task, ['one'])).rejects.toThrow('已有任务批次')
    release()
    await first
    await waitFinished(coordinator)
  })

  it('重启后把失去执行器的旧批次标为中断', async () => {
    const dir = path.join(root, 'runs', 'batch-old')
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, 'batch.json'), JSON.stringify({ id: 'batch-old', taskName: '旧任务', startedAt: new Date().toISOString(), devices: [{ serial: 'one', status: 'running' }], events: [] }))
    const coordinator = new BatchCoordinator(registry({}), () => {})
    const [record] = await coordinator.history()
    expect(record.finishedAt).toBeTruthy()
    expect(record.devices[0]).toMatchObject({ status: 'failure', error: '应用已退出，运行中断' })
  })

  it('摘要不携带日志，按设备读取只返回对应事件', async () => {
    const events: RunEvent[] = [
      { kind: 'step', at: '2026-01-01T00:00:00Z', message: '设备一', serial: 'one', batchId: 'batch-logs' },
      { kind: 'failure', at: '2026-01-01T00:00:01Z', message: '设备二', serial: 'two', batchId: 'batch-logs' }
    ]
    const dir = path.join(root, 'runs', 'batch-logs')
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, 'batch.json'), JSON.stringify({ id: 'batch-logs', taskName: '日志测试', startedAt: '2026-01-01T00:00:00Z', finishedAt: '2026-01-01T00:00:02Z', devices: [
      { serial: 'one', status: 'success' }, { serial: 'two', status: 'failure' }
    ], events }))
    const coordinator = new BatchCoordinator(registry({}), () => {})
    const page = await coordinator.historyPage(0)
    expect(page.items[0]).not.toHaveProperty('events')
    expect(await coordinator.events('batch-logs', 'one')).toEqual([events[0]])
    await expect(coordinator.events('batch-logs', 'missing')).rejects.toThrow('不存在')
    await expect(coordinator.events('../batch-logs', 'one')).rejects.toThrow('批次 ID 无效')
  })

  it('历史批次按二十条分页并保留后续页', async () => {
    const runs = path.join(root, 'runs')
    for (let index = 0; index < 45; index++) {
      const id = `batch-${String(index).padStart(3, '0')}`
      const dir = path.join(runs, id)
      await mkdir(dir, { recursive: true })
      await writeFile(path.join(dir, 'batch.json'), JSON.stringify({ id, taskName: id, startedAt: '2026-01-01T00:00:00Z', finishedAt: '2026-01-01T00:00:01Z', devices: [], events: [] }))
    }
    const coordinator = new BatchCoordinator(registry({}), () => {})
    const first = await coordinator.historyPage(0)
    const second = await coordinator.historyPage(1)
    const third = await coordinator.historyPage(2)
    expect([first.items.length, second.items.length, third.items.length]).toEqual([20, 20, 5])
    expect([first.hasMore, second.hasMore, third.hasMore]).toEqual([true, true, false])
    expect(first.items[0].id).toBe('batch-044')
    await expect(coordinator.historyPage(-1)).rejects.toThrow('页码无效')
  })
})
