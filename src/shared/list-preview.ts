/**
 * 列表预览判定：统一编辑器提示与步骤提交前的只读校验。
 */
import type { ListClickStep, ListPreviewRow } from './types'

/**
 * 判断当前屏预览能否证明定位条件可用。
 * @param step 待预览的列表步骤
 * @param rows 手机端只读扫描结果
 * @returns 无问题时返回 null，否则返回具体原因
 */
export function listPreviewIssue(step: ListClickStep, rows: readonly ListPreviewRow[]): string | null {
  if (!Array.isArray(rows) || !rows.length) return '当前滚动容器中未找到用户行'
  if (step.mode === 'rowState') {
    if (rows.some((row) => !('status' in row))) return '手机返回的用户行数据无效'
    const invalid = rows.find((row) => 'status' in row && !row.deferred &&
      (row.status === 'ambiguous' || row.status === 'missing' || Boolean(row.error)))
    if (invalid) return `当前用户行无法识别：${invalid.error || '未能区分关注状态'}`
    if (!rows.some((row) => 'status' in row && !row.deferred &&
      (row.status === 'pending' || row.status === 'completed'))) {
      return '当前屏没有可识别的完整用户行，请滚动到完整行后重试'
    }
    return null
  }
  return rows.every((row) => row.error) ? `当前用户行无法识别：${rows[0].error}` : null
}
