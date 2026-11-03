/**
 * 手机端直连会话心跳与快查询通道回归：验证保活、失联清理和 count 不与主连接互相排队。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CompanionSession } from '../src/main/companion-session'
import { connectCompanion, type PairedCompanion } from '../src/main/companion-client'
import type { Selector } from '../src/shared/types'

vi.mock('../src/main/companion-client', () => ({ connectCompanion: vi.fn() }))

const paired: PairedCompanion = {
  serial: 'direct:test', deviceId: 'test', model: 'test', ip: '192.168.1.2', fingerprint: 'AA', token: 'token'
}

const selector: Selector = { kind: 'text', value: '登录' }

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

describe('手机端直连快查询通道', () => {
  it('count 校验走第二连接，不占用主连接且懒连接复用', async () => {
    const main = { request: vi.fn(), isConnected: vi.fn().mockReturnValue(true), close: vi.fn() }
    const quick = {
      request: vi.fn(),
      count: vi.fn().mockResolvedValue(1),
      isConnected: vi.fn().mockReturnValue(true),
      close: vi.fn()
    }
    vi.mocked(connectCompanion)
      .mockResolvedValueOnce(main as never)
      .mockResolvedValueOnce(quick as never)
    const session = await CompanionSession.open(paired)

    await expect(session.count(selector)).resolves.toBe(1)
    // 第一次调用建立快通道，之后复用，不再新建连接
    await expect(session.count(selector)).resolves.toBe(1)
    expect(connectCompanion).toHaveBeenCalledTimes(2)
    expect(quick.count).toHaveBeenCalledWith(selector, 0)
    // 主连接只承担心跳与长命令，count 不应经过它
    expect(main.request).not.toHaveBeenCalled()

    await session.close()
    expect(quick.close).toHaveBeenCalledOnce()
  })

  it('matches 定位细化查询同样走快查询通道', async () => {
    const main = { request: vi.fn(), isConnected: vi.fn().mockReturnValue(true), close: vi.fn() }
    const matches = [{ index: 1, bounds: { left: 0, top: 0, right: 100, bottom: 100 } }]
    const quick = {
      request: vi.fn().mockResolvedValue(matches),
      count: vi.fn(),
      isConnected: vi.fn().mockReturnValue(true),
      close: vi.fn()
    }
    vi.mocked(connectCompanion)
      .mockResolvedValueOnce(main as never)
      .mockResolvedValueOnce(quick as never)
    const session = await CompanionSession.open(paired)

    await expect(session.matches(selector)).resolves.toEqual(matches)
    expect(quick.request).toHaveBeenCalledWith('inspectMatches', { selector })
    await session.close()
  })
})
