/**
 * 多设备投屏数量测试：工作台超限时拒绝，并在停止后释放名额。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'

const mirrorState = vi.hoisted(() => ({ active: 0, maxActive: 0, stopGate: null as Promise<void> | null }))
vi.mock('../src/main/mirroring', () => ({ MirrorService: class {
  start = vi.fn(async () => { mirrorState.active += 1; mirrorState.maxActive = Math.max(mirrorState.maxActive, mirrorState.active) })
  stop = vi.fn(async () => { await mirrorState.stopGate; mirrorState.active -= 1 })
  sendControl = vi.fn()
} }))
vi.mock('../src/main/scrcpy-server', () => ({ DEFAULT_SCRCPY_OPTIONS: { maxSize: 1024, bitRate: 6_000_000, maxFps: 60 } }))
import { MirrorRegistry } from '../src/main/mirror-registry'

describe('多画面投屏', () => {
  beforeEach(() => { mirrorState.active = 0; mirrorState.maxActive = 0; mirrorState.stopGate = null })

  it('同时最多四路，停止一台后可开启下一台', async () => {
    const registry = new MirrorRegistry()
    const window = {} as BrowserWindow
    for (let index = 0; index < 4; index++) await registry.start(window, `device-${index}`, 'wall')
    await expect(registry.start(window, 'device-4', 'wall')).rejects.toThrow('最多同时监看 4 台')
    await registry.stop('device-0')
    await expect(registry.start(window, 'device-4', 'wall')).resolves.toBeUndefined()
  })

  it('切换焦点时等待旧投屏真正释放，任一时刻不超过四路', async () => {
    const registry = new MirrorRegistry()
    const window = {} as BrowserWindow
    for (let index = 0; index < 4; index++) await registry.start(window, `device-${index}`, 'wall')
    let release!: () => void
    mirrorState.stopGate = new Promise<void>((resolve) => { release = resolve })
    const stopping = registry.stop('device-0')
    const starting = registry.start(window, 'device-4', 'wall')
    await Promise.resolve()
    expect(mirrorState.active).toBe(4)
    release()
    await Promise.all([stopping, starting])
    expect(mirrorState.active).toBe(4)
    expect(mirrorState.maxActive).toBe(4)
  })
})
