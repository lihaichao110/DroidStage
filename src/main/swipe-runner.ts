/**
 * 滑动命令执行：执行比例协议，校验手机回执并生成实际坐标日志。
 */
import type { SwipeResult, SwipeStep } from '../shared/types'
import type { AgentPort } from './session-port'

/**
 * 等待手机完成手势并返回实际路径；不支持新协议时明确要求升级。
 * @param step 已通过任务校验的滑动步骤
 * @param agent 当前设备代理
 * @returns 比例手势的实际区域日志
 * @throws 手机操作失败、协议不支持或回执无效时抛出
 */
export async function executeSwipe(step: SwipeStep, agent: AgentPort): Promise<string> {
  const waitMs = step.coordinateMode === 'elementPercent' ? step.timeoutMs : 0
  let result: unknown
  try {
    result = await agent.request('swipeRelative', {
      coordinateMode: step.coordinateMode, from: step.from, to: step.to, durationMs: step.durationMs,
      ...(step.coordinateMode === 'elementPercent' ? { container: step.container, timeoutMs: step.timeoutMs } : {})
    }, waitMs + step.durationMs + 5000) // 覆盖区域查找、完整手势及系统确认与通信时间
  } catch (error) {
    if (error instanceof Error && /未知(操作|命令).*swipeRelative/.test(error.message)) throw new Error('手机代理不支持比例滑动，请更新手机代理后重试')
    throw error
  }
  validateSwipeResult(result)
  const { bounds, from, to } = result
  return `实际滑动区域 [${bounds.left}, ${bounds.top}, ${bounds.right}, ${bounds.bottom}] · 像素 (${from.x}, ${from.y}) → (${to.x}, ${to.y})`
}

/** 严格检查运行回执，防止旧代理或异常响应被当成执行成功。 */
function validateSwipeResult(value: unknown): asserts value is SwipeResult {
  const error = (): never => { throw new Error('手机代理返回的滑动执行结果无效') }
  if (!value || typeof value !== 'object') error()
  const result = value as SwipeResult
  if (!result.bounds || !result.from || !result.to) error()
  const { left, top, right, bottom } = result.bounds
  if (![left, top, right, bottom, result.from.x, result.from.y, result.to.x, result.to.y]
    .every((n) => Number.isInteger(n) && n >= 0) || right <= left || bottom <= top) error()
  for (const point of [result.from, result.to]) {
    if (point.x < left || point.x >= right || point.y < top || point.y >= bottom) error()
  }
  if (result.from.x === result.to.x && result.from.y === result.to.y) error()
}
