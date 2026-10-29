/**
 * 列表批量执行：逐屏扫描、按标识去重、逐行重查点击并确认末页。
 */
import type { ListClickStep, ListRow } from '../shared/types'
import type { DeviceSessionPort } from './session-port'
import { runRowStateClick } from './row-state-runner'

export type ListResult = { success: number; skipped: number; alreadyDone: number }

/**
 * 遍历滚动容器直到手机端确认到末尾，最后一屏仍会完整处理。
 * @param step 列表批量步骤
 * @param session 已连接的设备会话
 * @param checkCancelled 取消检查，抛错后停止本步骤
 * @param report 用户级日志回调
 * @returns 点击成功、跳过和原已完成数量
 * @throws 容器丢失、设备断开或滚动次数用尽时抛出
 */
export async function runListClick(
  step: ListClickStep,
  session: DeviceSessionPort,
  checkCancelled: () => void,
  report: (name: string, reason: string) => Promise<void>
): Promise<ListResult> {
  if (step.mode === 'rowState') return runRowStateClick(step, session, checkCancelled, report)
  const agent = session.agent()
  const seen = new Set<string>()
  const invalidSeen = new Set<string>()
  const result: ListResult = { success: 0, skipped: 0, alreadyDone: 0 }
  let scrolls = 0
  let isLastScreen = false
  const selectors = { container: step.container, row: step.row, name: step.name, identity: step.identity, action: step.action, completed: step.completed }
  while (true) {
    checkCancelled()
    const rows = await agent.request<ListRow[]>('scanRows', selectors)
    if (!Array.isArray(rows)) throw new Error('手机返回的列表行数据无效')
    for (const row of rows) {
      checkCancelled()
      // 边缘半截行在下一屏会完整出现；末页则必须计入跳过，避免虚报全部完成。
      if (row.deferred && !isLastScreen) continue
      const name = row.name || '未命名用户'
      if (row.error || !row.key) {
        const reason = row.error || '未找到唯一标识'
        const fingerprint = `${name}\u0000${reason}`
        if (!invalidSeen.has(fingerprint)) {
          invalidSeen.add(fingerprint)
          result.skipped++
          await report(name, reason)
        }
        continue
      }
      if (seen.has(row.key)) continue
      seen.add(row.key)
      if (row.hasCompleted && !row.hasAction) { result.alreadyDone++; continue }
      if (!row.hasAction) {
        result.skipped++
        await report(name, '未找到待点击控件或完成状态')
        continue
      }
      // 点击前由手机按唯一标识重查行；点击后仍按同一标识确认完成，避免列表重排误认其他用户。
      const clicked = await agent.request<{ ok: boolean; reason?: string }>('tapRow', { ...selectors, key: row.key, timeoutMs: step.timeoutMs }, step.timeoutMs + 3000)
      if (clicked.ok) result.success++
      else {
        result.skipped++
        await report(name, clicked.reason || '点击后状态未变化')
      }
    }
    if (isLastScreen) break
    checkCancelled()
    if (scrolls >= step.maxScrolls) throw new Error(`已达到最多滚动次数 ${step.maxScrolls}，未确认列表末尾`)
    // false 表示到达末尾；即使返回 false，滚动也可能已改变可见行，因此再扫描一次。
    const canScrollMore = await agent.request<boolean>('scrollList', { container: step.container })
    scrolls++
    isLastScreen = !canScrollMore
  }
  return result
}
