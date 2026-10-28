/**
 * 无身份列表执行测试：用模拟扫描和画面采样验证跳过、确认及末页行为。
 */
import { describe, expect, it, vi } from 'vitest'
import type { DeviceSession } from '../src/main/session'
import { runListClick } from '../src/main/list-runner'
import type { ListClickStep, StateListRow } from '../src/shared/types'

vi.mock('../src/main/row-fingerprint', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/main/row-fingerprint')>()
  return { ...original, rowFingerprints: vi.fn(async (png: Buffer) =>
    (JSON.parse(png.toString()) as number[]).map((shade) => new Uint8Array(48 * 16).fill(shade))) }
})

const selector = (value: string) => ({ kind: 'text' as const, value })
const step: ListClickStep = {
  id: 'state', type: 'listClick', mode: 'rowState', container: selector('列表'),
  row: selector('用户行'), rowDepth: 1, action: selector('关注'), completed: selector('已关注'),
  maxScrolls: 10, timeoutMs: 1000
}
const row = (index: number, status: StateListRow['status'] = 'pending', extra: Partial<StateListRow> = {}): StateListRow => ({
  index, bounds: { left: 0, top: 50 * index, right: 300, bottom: 50 * index + 40 }, status, ...extra
})
type Screen = { rows: StateListRow[]; visuals: number[] }

function sessionFor(screens: Screen[], click: (index: number) => { ok: boolean; reason?: string } = () => ({ ok: true })) {
  let screen = 0
  const request = vi.fn(async (op: string, args: Record<string, unknown>) => {
    if (op === 'scanRows') return screens[screen].rows
    if (op === 'tapRow') {
      const outcome = click(Number(args.index))
      // 代理只有读到完成状态才会返回成功，模拟页也随之更新这一行。
      if (outcome.ok) screens[screen].rows[Number(args.index) - 1].status = 'completed'
      return outcome
    }
    if (op === 'scrollList') { screen = Math.min(screen + 1, screens.length - 1); return screen < screens.length - 1 }
    throw new Error(`未知操作：${op}`)
  })
  const session = { agent: () => ({ request }), screenshot: async () => Buffer.from(JSON.stringify(screens[screen].visuals)) } as unknown as DeviceSession
  return { session, request }
}

describe('按行状态遍历', () => {
  it('首次进入列表时等待空屏加载，不提前截图、点击或滚动', async () => {
    vi.useFakeTimers()
    try {
      let scans = 0
      const request = vi.fn(async (op: string) => {
        if (op === 'scanRows') return ++scans === 1 ? [] : [row(1, 'completed')]
        if (op === 'scrollList') return false
        throw new Error(`意外操作：${op}`)
      })
      const screenshot = vi.fn(async () => Buffer.from('[10]'))
      const session = { agent: () => ({ request }), screenshot } as unknown as DeviceSession
      const running = runListClick(step, session, () => {}, async () => {})
      await vi.advanceTimersByTimeAsync(199)
      expect(request.mock.calls.map(([op]) => op)).toEqual(['scanRows'])
      expect(screenshot).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(await running).toEqual({ success: 0, skipped: 0, alreadyDone: 0 })
      expect(request.mock.calls.filter(([op]) => op === 'scrollList')).toHaveLength(1)
    } finally { vi.useRealTimers() }
  })

  it('滚动后空屏只重扫当前屏，不额外消耗滚动次数', async () => {
    vi.useFakeTimers()
    try {
      let scrolls = 0
      let secondScreenScans = 0
      const request = vi.fn(async (op: string) => {
        if (op === 'scanRows') return scrolls === 0 ? [row(1, 'completed')]
          : ++secondScreenScans === 1 ? [] : [row(1, 'completed')]
        if (op === 'scrollList') { scrolls++; return false }
        throw new Error(`意外操作：${op}`)
      })
      const session = { agent: () => ({ request }), screenshot: async () => Buffer.from('[10]') } as unknown as DeviceSession
      const running = runListClick({ ...step, maxScrolls: 1 }, session, () => {}, async () => {})
      await vi.advanceTimersByTimeAsync(200)
      expect(await running).toEqual({ success: 0, skipped: 0, alreadyDone: 0 })
      expect(request.mock.calls.map(([op]) => op)).toEqual(['scanRows', 'scrollList', 'scanRows', 'scanRows'])
    } finally { vi.useRealTimers() }
  })

  it('当前屏持续为空时等待十秒后报出屏次，不尝试滚动或点击', async () => {
    vi.useFakeTimers()
    try {
      const request = vi.fn(async (_op: string) => [])
      const screenshot = vi.fn()
      const session = { agent: () => ({ request }), screenshot } as unknown as DeviceSession
      const running = runListClick(step, session, () => {}, async () => {})
      const failure = expect(running).rejects.toThrow('第 1 屏等待用户行加载超时（10 秒）')
      await vi.advanceTimersByTimeAsync(10000)
      await failure
      expect(request.mock.calls.every(([op]) => op === 'scanRows')).toBe(true)
      expect(screenshot).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })

  it('等待空屏期间响应取消，不再扫描或点击', async () => {
    vi.useFakeTimers()
    try {
      const request = vi.fn(async () => [])
      const session = { agent: () => ({ request }) } as unknown as DeviceSession
      let isCancelled = false
      const running = runListClick(step, session, () => { if (isCancelled) throw new Error('任务已取消') }, async () => {})
      const failure = expect(running).rejects.toThrow('任务已取消')
      await vi.advanceTimersByTimeAsync(199)
      isCancelled = true
      await vi.advanceTimersByTimeAsync(1)
      await failure
      expect(request).toHaveBeenCalledTimes(1)
    } finally { vi.useRealTimers() }
  })

  it('定位失败或无效行数据立即报错，不当作加载中重试', async () => {
    for (const response of [new Error('定位条件匹配多个控件'), [row(2)]]) {
      const request = vi.fn(async () => {
        if (response instanceof Error) throw response
        return response
      })
      const session = { agent: () => ({ request }) } as unknown as DeviceSession
      await expect(runListClick(step, session, () => {}, async () => {})).rejects.toThrow(
        response instanceof Error ? response.message : '手机返回的用户行数据无效'
      )
      expect(request).toHaveBeenCalledTimes(1)
    }
  })

  it('点击确认失败后继续，并在滚动重叠中不重试失败行', async () => {
    let thirdClicks = 0
    const { session, request } = sessionFor([
      { rows: [row(1), row(2), row(3)], visuals: [40, 80, 10] },
      { rows: [row(1, 'completed'), row(2), row(3)], visuals: [80, 60, 130] }
    ], (index) => index === 3 && ++thirdClicks === 1 ? { ok: false, reason: '点击后原行未出现已关注状态' } : { ok: true })
    const report = vi.fn(async () => {})
    expect(await runListClick(step, session, () => {}, report)).toEqual({ success: 3, skipped: 2, alreadyDone: 0 })
    expect(request.mock.calls.filter(([op]) => op === 'tapRow')).toHaveLength(4)
    expect(report).toHaveBeenCalledTimes(2)
    expect(report).toHaveBeenCalledWith('第 1 屏第 3 行', '点击后原行未出现已关注状态')
    expect(report).toHaveBeenCalledWith('第 2 屏第 2 行', '与上一屏已跳过行位置对应，本次运行不再尝试')
  })

  it('画面与失败行接近却不能确认相同时保守跳过并记录原因', async () => {
    const { session, request } = sessionFor([
      { rows: [row(1)], visuals: [10] },
      { rows: [row(1), row(2)], visuals: [18, 80] }
    ], (index) => index === 1 ? { ok: false, reason: '未确认' } : { ok: true })
    const report = vi.fn(async () => {})
    expect(await runListClick(step, session, () => {}, report)).toEqual({ success: 0, skipped: 3, alreadyDone: 0 })
    expect(request.mock.calls.filter(([op]) => op === 'tapRow')).toHaveLength(1)
    expect(report).toHaveBeenNthCalledWith(2, '第 2 屏第 1 行', expect.stringContaining('无法确认与上一屏的重叠关系'))
  })

  it('上一屏没有跳过行时允许继续处理画面全新的下一屏', async () => {
    const { session, request } = sessionFor([
      { rows: [row(1)], visuals: [10] },
      { rows: [row(1)], visuals: [80] }
    ])
    expect(await runListClick(step, session, () => {}, async () => {})).toEqual({ success: 2, skipped: 0, alreadyDone: 0 })
    expect(request.mock.calls.filter(([op]) => op === 'tapRow')).toHaveLength(2)
  })

  it('不完整行留到下一屏，末页仍不完整且状态不可辨时计入跳过', async () => {
    const { session, request } = sessionFor([
      { rows: [row(1, 'pending', { deferred: true })], visuals: [10] },
      { rows: [row(1), row(2, 'missing', { deferred: true, error: '未识别关注或已关注状态' })], visuals: [10, 80] }
    ])
    const report = vi.fn(async () => {})
    expect(await runListClick(step, session, () => {}, report)).toEqual({ success: 1, skipped: 1, alreadyDone: 0 })
    expect(request.mock.calls.filter(([op]) => op === 'tapRow')).toHaveLength(1)
    expect(report).toHaveBeenCalledWith('第 2 屏第 2 行', '未识别关注或已关注状态')
  })

  it('预览会指出的含糊行在执行时跳过，不误点其它行', async () => {
    const { session, request } = sessionFor([{ rows: [row(1, 'ambiguous', { error: '行内待点击控件不唯一' }), row(2)], visuals: [10, 10] }])
    const report = vi.fn(async () => {})
    expect(await runListClick(step, session, () => {}, report)).toEqual({ success: 1, skipped: 2, alreadyDone: 0 })
    expect(request.mock.calls.filter(([op]) => op === 'tapRow')).toHaveLength(1)
    expect(report).toHaveBeenCalledWith('第 1 屏第 1 行', '行内待点击控件不唯一')
  })

  it('单行没有可见边界时记为跳过，仍继续处理同屏其它行', async () => {
    const hidden = row(1, 'ambiguous', { bounds: { left: 0, top: 0, right: 0, bottom: 0 }, error: '用户行没有可见边界' })
    const { session, request } = sessionFor([{ rows: [hidden, row(2)], visuals: [80] }])
    const report = vi.fn(async () => {})
    expect(await runListClick(step, session, () => {}, report)).toEqual({ success: 1, skipped: 2, alreadyDone: 0 })
    expect(request.mock.calls.filter(([op]) => op === 'tapRow')).toHaveLength(1)
    expect(report).toHaveBeenCalledWith('第 1 屏第 1 行', '用户行没有可见边界')
  })

  it('超过滚动上限且未确认末页时明确失败', async () => {
    const session = { agent: () => ({ request: async (op: string) => op === 'scanRows' ? [row(1, 'completed')] : true }),
      screenshot: async () => Buffer.from('[10]') } as unknown as DeviceSession
    await expect(runListClick({ ...step, maxScrolls: 1 }, session, () => {}, async () => {})).rejects.toThrow('未确认列表末尾')
  })
})
