/**
 * 列表运行汇总：按遍历模式分别计数，避免把无标识行次写成唯一用户数。
 */
export type ListTotals = {
  rowSuccess: number
  rowSkipped: number
  identitySuccess: number
  identitySkipped: number
  identityDone: number
  hasRowState: boolean
  hasIdentity: boolean
}

/**
 * 格式化列表步骤的任务级结果。
 * @param totals 两种模式分别累计的执行结果
 * @returns 面向运行日志的中文摘要
 */
export function listSummary(totals: ListTotals): string {
  const row = `成功点击 ${totals.rowSuccess} 次，跳过 ${totals.rowSkipped} 行次`
  const identity = `成功 ${totals.identitySuccess}，跳过 ${totals.identitySkipped}，原已完成 ${totals.identityDone}`
  if (totals.hasRowState && totals.hasIdentity) return `按行状态：${row}；按唯一标识：${identity}`
  return totals.hasRowState ? row : identity
}
