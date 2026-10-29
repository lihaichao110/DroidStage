/**
 * 手机端直连会话心跳回归：验证持续保活和失联状态清理。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CompanionSession } from '../src/main/companion-session'
import { connectCompanion, type PairedCompanion } from '../src/main/companion-client'

vi.mock('../src/main/companion-client', () => ({ connectCompanion: vi.fn() }))

const paired: PairedCompanion = {
  serial: 'direct:test', deviceId: 'test', model: 'test', ip: '192.168.1.2', fingerprint: 'AA', token: 'token'
}

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

describe('手机端直连会话心跳', () => {
  it('连接期间定期发送心跳，关闭后停止', async () => {
    vi.useFakeTimers()
    const client = { request: vi.fn().mockResolvedValue({}), isConnected: vi.fn().mockReturnValue(true), close: vi.fn() }
    vi.mocked(connectCompanion).mockResolvedValue(client as never)
    const session = await CompanionSession.open(paired)

    await vi.advanceTimersByTimeAsync(45000)
    expect(client.request).toHaveBeenCalledTimes(3)
    expect(client.request).toHaveBeenCalledWith('ping', {}, 5000)

    await session.close()
    await vi.advanceTimersByTimeAsync(30000)
    expect(client.request).toHaveBeenCalledTimes(3)
    expect(client.close).toHaveBeenCalledOnce()
  })

  it('心跳失败后关闭会话，不能继续显示已连接', async () => {
    vi.useFakeTimers()
    let isConnected = true
    const client = {
      request: vi.fn().mockRejectedValue(new Error('操作超时')),
      isConnected: vi.fn(() => isConnected),
      close: vi.fn(() => { isConnected = false })
    }
    vi.mocked(connectCompanion).mockResolvedValue(client as never)
    const session = await CompanionSession.open(paired)

    await vi.advanceTimersByTimeAsync(15000)
    expect(client.close).toHaveBeenCalledOnce()
    expect(session.isAlive()).toBe(false)
    await session.close()
  })
})
