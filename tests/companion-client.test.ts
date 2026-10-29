/**
 * 手机端直连身份与错误映射回归：避免证书变化或端口拒绝被误报为已连接。
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => 'C:/tmp/droidstage-test' } }))
vi.mock('../src/main/adb', () => ({ adb: vi.fn(), onDevice: vi.fn() }))

import { companionError, verifyFingerprint } from '../src/main/companion-client'

describe('手机端直连连接前校验', () => {
  it('固定配对证书，拒绝缺失和变化的指纹', () => {
    expect(() => verifyFingerprint('AA:BB', 'aa:bb')).not.toThrow()
    expect(() => verifyFingerprint(undefined, 'AA:BB')).toThrow('重新通过 USB 配对')
    expect(() => verifyFingerprint('CC:DD', 'AA:BB')).toThrow('重新通过 USB 配对')
  })

  it('端口被拒绝时提示在手机上启动独立服务', () => {
    const error = companionError(new Error('connect ECONNREFUSED 192.168.1.2:39828'), '192.168.1.2')
    expect(error.message).toContain('启动无线服务')
    expect(error.message).toContain('ECONNREFUSED')
  })

  it('网络不可达与其他认证错误各保留真实原因', () => {
    expect(companionError(new Error('ETIMEDOUT'), '192.168.1.2').message).toContain('查看“无线服务”是否仍为已启动')
    expect(companionError(new Error('无线会话验证失败'), '192.168.1.2').message).toBe('无线会话验证失败')
  })
})
