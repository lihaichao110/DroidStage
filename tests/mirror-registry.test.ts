/**
 * 多设备投屏数量测试：监看页超限时拒绝，并在切页停止后释放名额。
 */
import { describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'

vi.mock('../src/main/mirroring', () => ({ MirrorService: class {
  start = vi.fn(async () => {})
  stop = vi.fn(async () => {})
  sendControl = vi.fn()
} }))
vi.mock('../src/main/scrcpy-server', () => ({ DEFAULT_SCRCPY_OPTIONS: { maxSize: 1024, bitRate: 6_000_000, maxFps: 60 } }))
import { MirrorRegistry } from '../src/main/mirror-registry'

describe('多画面投屏', () => {
  it('同页最多六路，停止一台后可开启下一台', async () => {
    const registry = new MirrorRegistry()
    const window = {} as BrowserWindow
    for (let index = 0; index < 6; index++) await registry.start(window, `device-${index}`, 'wall')
    await expect(registry.start(window, 'device-6', 'wall')).rejects.toThrow('最多同时显示 6 台')
    await registry.stop('device-0')
    await expect(registry.start(window, 'device-6', 'wall')).resolves.toBeUndefined()
  })
})
