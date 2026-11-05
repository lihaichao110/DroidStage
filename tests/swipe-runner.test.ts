/**
 * 比例滑动执行测试：验证协议参数、完整超时预算和异常回执拒绝。
 */
import { describe, expect, it, vi } from 'vitest'
import { executeSwipe } from '../src/main/swipe-runner'
import type { AgentPort } from '../src/main/session-port'
import type { SwipeStep } from '../src/shared/types'

const screen: SwipeStep = { id: 's', type: 'swipe', coordinateMode: 'screenPercent', from: { x: 50, y: 80 }, to: { x: 50, y: 20 }, durationMs: 500 }
const result = { bounds: { left: 0, top: 0, right: 1080, bottom: 2400 }, from: { x: 540, y: 1919 }, to: { x: 540, y: 480 } }

describe('比例滑动执行', () => {
  it('发送比例命令并等待完整手势，将实际路径用于日志', async () => {
    const request = vi.fn().mockResolvedValue(result)
    const detail = await executeSwipe(screen, { request } as unknown as AgentPort)
    expect(request).toHaveBeenCalledWith('swipeRelative', {
      coordinateMode: 'screenPercent', from: screen.from, to: screen.to, durationMs: 500
    }, 5500)
    expect(detail).toBe('实际滑动区域 [0, 0, 1080, 2400] · 像素 (540, 1919) → (540, 480)')
  })

  it('控件模式的超时覆盖最长查找、滑动及通信时间', async () => {
    const request = vi.fn().mockResolvedValue(result)
    const container = { kind: 'resourceId' as const, value: 'list', matchIndex: 2 }
    await executeSwipe({ ...screen, coordinateMode: 'elementPercent', container, timeoutMs: 60000, durationMs: 10000 }, { request } as unknown as AgentPort)
    expect(request).toHaveBeenCalledWith('swipeRelative', expect.objectContaining({ container, timeoutMs: 60000, durationMs: 10000 }), 75000)
  })

  it.each(['未知操作：swipeRelative', '未知命令：swipeRelative'])('旧代理报错时提示升级且不降级：%s', async (message) => {
    const request = vi.fn().mockRejectedValue(new Error(message))
    await expect(executeSwipe(screen, { request } as unknown as AgentPort)).rejects.toThrow('请更新手机代理')
    expect(request).toHaveBeenCalledTimes(1)
  })

  it.each(['未找到控件', '定位条件匹配多个控件', '滑动区域在屏幕内不可见', '屏幕方向或尺寸已改变', '手势操作未完成', '设备已断开'])('传播手机真实失败：%s', async (message) => {
    const request = vi.fn().mockRejectedValue(new Error(message))
    await expect(executeSwipe(screen, { request } as unknown as AgentPort)).rejects.toThrow(message)
  })

  it.each([
    undefined, null, 'ok', {},
    { ...result, from: { x: 1080, y: 20 } },
    { ...result, to: { x: -1, y: 20 } },
    { ...result, from: { x: 50.5, y: 20 } },
    { ...result, bounds: { left: 0, top: 0, right: 0, bottom: 2400 } },
    { ...result, to: result.from }
  ])('拒绝无效执行回执 %j', async (value) => {
    await expect(executeSwipe(screen, { request: vi.fn().mockResolvedValue(value) } as unknown as AgentPort)).rejects.toThrow('执行结果无效')
  })
})
