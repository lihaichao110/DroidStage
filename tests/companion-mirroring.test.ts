/**
 * 直连投屏状态测试：编码器配置到达时仍等待真实关键帧。
 */
import { describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import type { CompanionSession } from '../src/main/companion-session'
import { CompanionMirrorService } from '../src/main/companion-mirroring'

describe('手机端直连投屏', () => {
  it('收到 H.264 IDR 关键帧后才报告推流成功', async () => {
    const send = vi.fn()
    const window = { isDestroyed: () => false, webContents: { isDestroyed: () => false, send } } as unknown as BrowserWindow
    let onVideo: ((event: { event: 'video'; data: string }) => void) | null = null
    const request = vi.fn(async () => ({ physicalWidth: 1080, physicalHeight: 2340 }))
    const session = { serial: 'direct:test', isAlive: () => true, agent: () => ({ request }),
      onVideo: (listener: typeof onVideo) => { onVideo = listener } } as unknown as CompanionSession
    const mirror = new CompanionMirrorService()
    await mirror.start(window, session, 'wall')
    onVideo!({ event: 'video', data: Buffer.from([0, 0, 0, 1, 0x67, 1]).toString('base64') })
    expect(send.mock.calls.some(([name, item]) => name === 'mirror:status' && item.status.state === 'streaming')).toBe(false)
    onVideo!({ event: 'video', data: Buffer.from([0, 0, 0, 1, 0x65, 1]).toString('base64') })
    expect(send.mock.calls.some(([name, item]) => name === 'mirror:status' && item.status.state === 'streaming')).toBe(true)
    await mirror.stop()
  })
})
