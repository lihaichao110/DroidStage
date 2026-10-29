/**
 * 真机直连验收：仅显式设置 DROIDSTAGE_LIVE=1 时使用已配对设备和测试页。
 */
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => path.join(process.env.APPDATA || '', 'droidstage') } }))
vi.mock('../src/main/adb', () => ({ adb: vi.fn(), onDevice: vi.fn(), listDevices: vi.fn(() => { throw new Error('拔线后 ADB 不可用') }) }))

import { readFile } from 'node:fs/promises'
import { listDevices } from '../src/main/adb'
import { BatchCoordinator } from '../src/main/batch-coordinator'
import { CompanionStore } from '../src/main/companion-client'
import { CompanionSession } from '../src/main/companion-session'
import { DeviceRegistry } from '../src/main/device-registry'

const live = process.env.DROIDSTAGE_LIVE === '1'
const selector = (id: string) => ({ kind: 'resourceId' as const, value: `dev.androidautodesk.host:id/${id}` })

describe('拔线后的真机直连', () => {
  it.skipIf(!live)('执行基础任务并接收 H.264 帧', async () => {
    const paired = (await new CompanionStore().list()).find((item) => item.model === 'ELE-AL00')
    expect(paired).toBeDefined()
    const session = await CompanionSession.open(paired!)
    try {
      expect(await session.count(selector('test_input'))).toBe(1)
      await session.agent().request('input', { selector: selector('test_input'), text: '纯无线验收' })
      await session.agent().request('tap', { selector: selector('test_button') })
      expect(await session.count({ kind: 'text', value: '纯无线验收' })).toBeGreaterThan(0)
      expect((await session.snapshot()).nodes.length).toBeGreaterThan(0)
      expect((await session.screenshot()).subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))

      let frames = 0
      let keyframe = false
      session.onVideo((event) => {
        const bytes = Buffer.from(event.data, 'base64')
        frames++
        if (bytes.subarray(0, 5).equals(Buffer.from([0, 0, 0, 1, 0x65]))) keyframe = true
      })
      const size = await session.agent().request<{ physicalWidth: number; physicalHeight: number }>('mirrorStart',
        { maxSize: 640, bitRate: 1_500_000, fps: 15 })
      expect(size.physicalWidth).toBeGreaterThan(0)
      await new Promise((resolve) => setTimeout(resolve, 1500))
      await session.agent().request('mirrorStop')
      expect(frames).toBeGreaterThan(2)
      expect(keyframe).toBe(true)
      await session.launch('com.android.settings')
      expect((await session.snapshot()).nodes.length).toBeGreaterThan(0)
    } finally { await session.close() }
  }, 30000)

  it.skipIf(!live)('拔线后从批次入口启动应用、执行按键并保存截图', async () => {
    const paired = (await new CompanionStore().list()).find((item) => item.model === 'ELE-AL00')
    expect(paired).toBeDefined()
    const devices = new DeviceRegistry()
    await devices.connect(paired!.serial)
    try {
      const batch = new BatchCoordinator(devices, () => {})
      await batch.start({ version: 1, name: '纯无线桌面任务', packageName: 'com.android.settings', steps: [
        { id: 'shot', type: 'screenshot' }, { id: 'home', type: 'key', key: 'home' }
      ] }, [paired!.serial])
      await vi.waitFor(() => expect(batch.state()?.finishedAt).toBeTruthy(), { timeout: 15000 })
      expect(batch.state()?.devices[0].status).toBe('success')
      const shot = await readFile(path.join(batch.state()!.devices[0].runDir!, 'step-001.png'))
      expect(shot.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      expect(listDevices).not.toHaveBeenCalled()
    } finally { await devices.closeAll() }
  }, 30000)
})
