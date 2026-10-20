/**
 * 投屏回调测试：窗口关闭后迟到的视频和退出事件不能访问已销毁的 webContents。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'

const mockServers = vi.hoisted(() => [] as Array<{
  onData: (chunk: Buffer) => void
  onExit: (message: string | null) => void
}>)

vi.mock('../src/main/adb', () => ({
  adb: vi.fn(async () => Buffer.from('Physical size: 1080x2400')),
  onDevice: vi.fn(() => [])
}))

vi.mock('../src/main/scrcpy-server', () => ({
  ScrcpyServer: class {
    onData: (chunk: Buffer) => void = () => {}
    onExit: (message: string | null) => void = () => {}
    constructor() { mockServers.push(this) }
    async start(): Promise<void> {}
    async stop(): Promise<void> {}
  }
}))

import { MirrorService } from '../src/main/mirroring'

/** 模拟 Electron 在窗口销毁后访问 webContents 即抛错的行为。 */
function createWindow(): {
  window: BrowserWindow
  send: ReturnType<typeof vi.fn>
  destroy: () => void
} {
  let isDestroyed = false
  const send = vi.fn()
  const contents = { isDestroyed: () => isDestroyed, send }
  const window = {
    isDestroyed: () => isDestroyed,
    get webContents() {
      if (isDestroyed) throw new Error('Object has been destroyed')
      return contents
    }
  } as unknown as BrowserWindow
  return { window, send, destroy: () => { isDestroyed = true } }
}

describe('投屏窗口生命周期', () => {
  beforeEach(() => { mockServers.length = 0 })

  it('窗口存活时按顺序发送状态、流信息和视频数据', async () => {
    const { window, send } = createWindow()
    const mirror = new MirrorService()
    await mirror.start(window, 'device-1')
    const server = mockServers[0]

    server.onData(Buffer.from([0, 0, 0, 1]))
    server.onExit(null)

    expect(send.mock.calls.map(([channel]) => channel)).toEqual([
      'mirror:status', 'mirror:stream', 'mirror:status', 'mirror:chunk', 'mirror:status'
    ])
    expect(send.mock.calls[1][1]).toEqual({ serial: 'device-1', physicalWidth: 1080, physicalHeight: 2400 })
    expect(send.mock.calls[3][1]).toEqual({ serial: 'device-1', bytes: new Uint8Array([0, 0, 0, 1]) })
    expect(send.mock.calls[4][1]).toEqual({ serial: 'device-1', status: { state: 'stopped' } })
  })

  it('关闭窗口后，迟到的视频和退出回调不访问 webContents', async () => {
    const { window, send, destroy } = createWindow()
    const mirror = new MirrorService()
    await mirror.start(window, 'device-1')
    const server = mockServers[0]
    server.onData(Buffer.from([1]))
    const sentBeforeClose = send.mock.calls.length
    destroy()

    expect(() => server.onData(Buffer.from([2]))).not.toThrow()
    expect(() => server.onExit(null)).not.toThrow()
    expect(send).toHaveBeenCalledTimes(sentBeforeClose)
  })

  it('首块视频到达前关闭窗口也不会触发异常', async () => {
    const { window, send, destroy } = createWindow()
    const mirror = new MirrorService()
    await mirror.start(window, 'device-1')
    destroy()

    expect(() => mockServers[0].onData(Buffer.from([1]))).not.toThrow()
    expect(() => mockServers[0].onExit('投屏连接已断开')).not.toThrow()
    expect(send).toHaveBeenCalledTimes(1)
  })
})
