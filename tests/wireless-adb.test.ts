/**
 * 无线 ADB 输入测试：拒绝非法端点和配对码，并确认连接后设备确实在线。
 */
import { describe, expect, it, vi } from 'vitest'
vi.mock('../src/main/adb', () => ({ adb: vi.fn(), listDevices: vi.fn() }))
import { adb, listDevices } from '../src/main/adb'
import { connectWireless, pairWireless, validateEndpoint } from '../src/main/wireless-adb'

describe('无线 ADB', () => {
  it('拒绝空端口、越界端口和命令参数', () => {
    expect(validateEndpoint(' 192.168.1.10:37123 ')).toBe('192.168.1.10:37123')
    expect(() => validateEndpoint('192.168.1.10:0')).toThrow()
    expect(() => validateEndpoint('-s:1234')).toThrow()
    expect(() => validateEndpoint('192.168.1.10:99999')).toThrow()
  })

  it('配对码无效时不调用 ADB', async () => {
    vi.mocked(adb).mockClear()
    await expect(pairWireless('192.168.1.10:37123', '123')).rejects.toThrow('6 位配对码')
    expect(adb).not.toHaveBeenCalled()
  })

  it('连接命令返回后仍检查在线列表', async () => {
    vi.mocked(adb).mockResolvedValue(Buffer.from('connected to 192.168.1.10:38901'))
    vi.mocked(listDevices).mockResolvedValue([])
    await expect(connectWireless('192.168.1.10:38901')).rejects.toThrow('未就绪')
  })
})
