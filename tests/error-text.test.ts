/**
 * IPC 错误展示回归：移除 Electron 包装文字但保留网络与手机端原始原因。
 */
import { describe, expect, it } from 'vitest'
import { errorText } from '../src/shared/error-text'

describe('errorText', () => {
  it('只移除远程方法包装前缀', () => {
    expect(errorText(new Error("Error invoking remote method 'device:connect': Error: 手机未授权"))).toBe('手机未授权')
    expect(errorText(new Error('connect ECONNREFUSED 192.168.1.2:39828'))).toContain('ECONNREFUSED')
  })
})
