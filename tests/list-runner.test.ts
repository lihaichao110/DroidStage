/**
 * 列表遍历测试：验证行去重、状态确认、末页处理及停止条件。
 */
import { describe, expect, it, vi } from 'vitest'
import type { ListClickStep, ListRow } from '../src/shared/types'
import type { DeviceSession } from '../src/main/session'
import { runListClick } from '../src/main/list-runner'

const selector = (value: string) => ({ kind: 'text' as const, value })
const step: ListClickStep = {
  id: 'list', type: 'listClick', container: selector('列表'), row: selector('用户行'),
  name: selector('昵称'), identity: selector('账号'), action: selector('关注'), completed: selector('已关注'),
  maxScrolls: 100, timeoutMs: 1000
}
const row = (name: string, hasAction = true, hasCompleted = false): ListRow => ({ name, key: name, hasAction, hasCompleted })

function sessionFor(screens: ListRow[][], click: (key: string) => { ok: boolean; reason?: string } = () => ({ ok: true })) {
  let screen = 0
  const request = vi.fn(async (op: string, args: Record<string, unknown>) => {
    if (op === 'scanRows') return screens[screen]
    if (op === 'tapRow') return click(String(args.key))
    if (op === 'scrollList') { screen = Math.min(screen + 1, screens.length - 1); return screen < screens.length - 1 }
    throw new Error(`未知操作：${op}`)
  })
  return { session: { agent: () => ({ request }) } as unknown as DeviceSession, request }
}

describe('列表批量点击', () => {
  it('同屏多用户、跨屏重叠去重并处理末页，已完成用户不点击', async () => {
    const { session, request } = sessionFor([
      [row('甲'), row('乙'), row('丙', false, true)],
      [row('乙'), row('丁')]
    ])
    const report = vi.fn(async () => {})
    expect(await runListClick(step, session, () => {}, report)).toEqual({ success: 3, skipped: 0, alreadyDone: 1 })
    expect(request.mock.calls.filter(([op]) => op === 'tapRow').map(([, args]) => args.key)).toEqual(['甲', '乙', '丁'])
    expect(request.mock.calls.filter(([op]) => op === 'scanRows')).toHaveLength(2)
  })

  it('边缘半截行留到下一屏处理，末页仍不完整时计入跳过', async () => {
    const partial = { ...row('乙', false), deferred: true }
    const { session, request } = sessionFor([
      [row('甲'), partial],
      [row('乙'), { ...row('丙', false), deferred: true }]
    ])
    const report = vi.fn(async () => {})
    expect(await runListClick(step, session, () => {}, report)).toEqual({ success: 2, skipped: 1, alreadyDone: 0 })
    expect(request.mock.calls.filter(([op]) => op === 'tapRow').map(([, args]) => args.key)).toEqual(['甲', '乙'])
    expect(report).toHaveBeenCalledWith('丙', '未找到待点击控件或完成状态')
  })

  it('单人失败后继续，日志带名称与原因', async () => {
    const { session } = sessionFor([[row('甲'), row('乙')]], (key) => key === '甲' ? { ok: false, reason: '状态未变化' } : { ok: true })
    const report = vi.fn(async () => {})
    expect(await runListClick(step, session, () => {}, report)).toEqual({ success: 1, skipped: 1, alreadyDone: 0 })
    expect(report).toHaveBeenCalledWith('甲', '状态未变化')
  })

  it('取消时立即停止后续点击与滚动', async () => {
    const { session, request } = sessionFor([[row('甲'), row('乙')]])
    let checks = 0
    await expect(runListClick(step, session, () => { if (++checks === 3) throw new Error('已取消') }, async () => {})).rejects.toThrow('已取消')
    expect(request.mock.calls.filter(([op]) => op === 'tapRow')).toHaveLength(1)
    expect(request.mock.calls.filter(([op]) => op === 'scrollList')).toHaveLength(0)
  })

  it('未确认末尾即达到滚动上限时报失败', async () => {
    const request = vi.fn(async (op: string) => op === 'scanRows' ? [row('甲')] : true)
    const session = { agent: () => ({ request }) } as unknown as DeviceSession
    await expect(runListClick({ ...step, maxScrolls: 1 }, session, () => {}, async () => {})).rejects.toThrow('未确认列表末尾')
  })

  it('容器丢失或代理断开属于任务失败', async () => {
    const session = { agent: () => ({ request: async () => { throw new Error('容器丢失') } }) } as unknown as DeviceSession
    await expect(runListClick(step, session, () => {}, async () => {})).rejects.toThrow('容器丢失')
  })
})
