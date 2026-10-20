/**
 * 多设备会话测试：失效连接不应显示成功，重新连接应释放旧会话。
 */
import { describe, expect, it, vi } from 'vitest'
vi.mock('../src/main/session', () => ({ DeviceSession: { open: vi.fn() } }))
import { DeviceSession } from '../src/main/session'
import { DeviceRegistry } from '../src/main/device-registry'

describe('设备会话管理', () => {
  it('过滤失效会话并在重新连接时关闭旧会话', async () => {
    let alive = true
    const first = { isAlive: () => alive, close: vi.fn(async () => {}) } as unknown as DeviceSession
    const second = { isAlive: () => true, close: vi.fn(async () => {}) } as unknown as DeviceSession
    vi.mocked(DeviceSession.open).mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    const registry = new DeviceRegistry()
    await registry.connect('serial-1')
    expect(registry.states()).toEqual([{ serial: 'serial-1', connected: true }])
    alive = false
    expect(registry.states()).toEqual([])
    expect(() => registry.require('serial-1')).toThrow('辅助服务已断开')
    await registry.connect('serial-1')
    expect(first.close).toHaveBeenCalledOnce()
    expect(registry.require('serial-1')).toBe(second)
    await registry.closeAll()
  })
})
