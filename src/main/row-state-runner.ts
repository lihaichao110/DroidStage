/**
 * 无身份列表执行：按行状态点击，用画面指纹避免对滚动重叠中的失败行复点。
 */
import type { ListClickStep, StateListRow } from '../shared/types'
import type { DeviceSessionPort } from './session-port'
import type { ListResult } from './list-runner'
import { overlapShift, rowFingerprints } from './row-fingerprint'

type StateStep = Extract<ListClickStep, { mode: 'rowState' }>
type ScreenRow = { sample?: Uint8Array; processed: 'success' | 'skipped' | 'completed' | null }
const ROW_LOAD_WAIT_MS = 10000 // 页面切换或滚动后，列表行加载完成的最长等待时间
const ROW_LOAD_POLL_MS = 200 // 只对空列表短轮询，避免把加载动画误判成没有用户行

/**
 * 遍历列表中的待关注行；无法确认成功时记为跳过并继续。
 * @param step 按行状态遍历步骤
 * @param session 已连接设备
 * @param checkCancelled 取消检查
 * @param report 跳过原因日志
 * @returns 成功点击次数与跳过行次
 * @throws 容器丢失、用户行加载超时、截图失败或滚动上限耗尽时抛出
 */
export async function runRowStateClick(
  step: StateStep,
  session: DeviceSessionPort,
  checkCancelled: () => void,
  report: (name: string, reason: string) => Promise<void>
): Promise<ListResult> {
  const agent = session.agent()
  const result: ListResult = { success: 0, skipped: 0, alreadyDone: 0 }
  const selectors = { mode: 'rowState', container: step.container, row: step.row,
    rowDepth: step.rowDepth, action: step.action, completed: step.completed }
  let scrolls = 0
  let isLastScreen = false
  let previousScreen: ScreenRow[] | null = null
  /** 等待当前屏真正出现用户行；定位或通信错误仍立即交给上层处理。 */
  const scanReadyRows = async (): Promise<StateListRow[]> => {
    const deadline = Date.now() + ROW_LOAD_WAIT_MS
    while (true) {
      checkCancelled()
      const rows = await agent.request<StateListRow[]>('scanRows', selectors)
      if (!Array.isArray(rows) || rows.some((row, offset) => !validRow(row) || row.index !== offset + 1)) throw new Error('手机返回的用户行数据无效')
      if (rows.length > 0) return rows
      if (Date.now() >= deadline) throw new Error(`第 ${scrolls + 1} 屏等待用户行加载超时（10 秒）`)
      // 空结果可能只是页面还在加载；不截图、不点击，也不消耗滚动次数。
      await new Promise((resolve) => setTimeout(resolve, Math.min(ROW_LOAD_POLL_MS, deadline - Date.now())))
    }
  }
  while (true) {
    const rows = await scanReadyRows()
    // 截图只为本次运行内的跳过行比对，不写入任务文件或运行日志。
    const visualRows = rows.filter(hasVisibleBounds)
    const samples = visualRows.length ? await rowFingerprints(await session.screenshot(), visualRows.map((row) => row.bounds)) : []
    const samplesByRow = new Map(visualRows.map((row, offset) => [row, samples[offset]]))
    const currentScreen: ScreenRow[] = rows.map((row) => ({ sample: samplesByRow.get(row), processed: null }))
    const shift = previousScreen ? overlapShift(screenSamples(previousScreen), screenSamples(currentScreen)) : null
    const skipRow = async (offset: number, name: string, reason: string): Promise<void> => {
      result.skipped++
      currentScreen[offset].processed = 'skipped'
      await report(name, reason)
    }
    for (const [offset, row] of rows.entries()) {
      checkCancelled()
      if (row.deferred && !isLastScreen) continue
      if (row.status === 'completed') { currentScreen[offset].processed = 'completed'; continue }
      const name = `第 ${scrolls + 1} 屏第 ${offset + 1} 行`
      if (!hasVisibleBounds(row)) {
        await skipRow(offset, name, row.error || '用户行没有可见边界')
        continue
      }
      // 上一屏有失败行时，找不到可靠画面锚点就不能判断当前候选是否为失败行。
      if (previousScreen?.some((prior) => prior.processed === 'skipped') && shift === null) {
        await skipRow(offset, name, '滚动后无法确认与上一屏的重叠关系，可能是已处理行')
        continue
      }
      const matched = previousScreen && shift !== null ? previousScreen[offset + shift] : undefined
      if (matched?.processed) {
        await skipRow(offset, name, matched.processed === 'skipped'
          ? '与上一屏已跳过行位置对应，本次运行不再尝试'
          : '与上一屏已处理行位置对应，无法确认是新用户行')
        continue
      }
      if (row.status !== 'pending' || row.error) {
        await skipRow(offset, name, row.error || '未识别关注状态')
        continue
      }
      // 手机端按本屏序号和边界重查；画面变化时不得用旧序号盲点其它行。
      const clicked = await agent.request<{ ok: boolean; reason?: string }>('tapRow',
        { ...selectors, index: row.index, bounds: row.bounds, timeoutMs: step.timeoutMs }, step.timeoutMs + 3000)
      if (clicked.ok) { result.success++; currentScreen[offset].processed = 'success' }
      else {
        await skipRow(offset, name, clicked.reason || '点击后状态未变化')
      }
    }
    if (isLastScreen) break
    checkCancelled()
    if (scrolls >= step.maxScrolls) throw new Error(`已达到最多滚动次数 ${step.maxScrolls}，未确认列表末尾`)
    previousScreen = currentScreen
    const canScrollMore = await agent.request<boolean>('scrollList', { container: step.container })
    scrolls++
    isLastScreen = !canScrollMore
  }
  return result
}

/** 仅用可见行建立画面锚点；无边界行不能参与滚动位移判断。 */
function screenSamples(rows: readonly ScreenRow[]): { index: number; sample: Uint8Array }[] {
  return rows.flatMap((row, index) => row.sample ? [{ index, sample: row.sample }] : [])
}

/** 检查手机端返回值，避免无效边界或序号进入截图与点击流程。 */
function validRow(row: StateListRow): boolean {
  const bounds = row?.bounds
  return Boolean(row && Number.isInteger(row.index) && row.index > 0 && bounds &&
    [bounds.left, bounds.top, bounds.right, bounds.bottom].every(Number.isInteger) &&
    ['pending', 'completed', 'missing', 'ambiguous'].includes(row.status))
}

/** 零尺寸行由手机端明确报出，记录为跳过而不让截图裁剪使整步失败。 */
function hasVisibleBounds(row: StateListRow): boolean {
  return row.bounds.right > row.bounds.left && row.bounds.bottom > row.bounds.top
}
