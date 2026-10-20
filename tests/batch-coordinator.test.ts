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
  return { require(serial: string) { const session = sessions[serial]; if (!session) throw new Error('未连接'); return session } } as DeviceRegistry
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

  it('目标离线时拒绝启动整个批次', async () => {
    vi.mocked(listDevices).mockResolvedValue([{ serial: 'one', state: 'device', usb: true }])
    const session = { agent: () => ({ request: vi.fn(async () => {}) }) } as unknown as DeviceSession
    const coordinator = new BatchCoordinator(registry({ one: session, two: session }), () => {})
    await expect(coordinator.start(task, ['one', 'two'])).rejects.toThrow('设备 two 已离线')
    expect(coordinator.state()).toBeNull()
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
})
