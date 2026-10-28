/**
 * 列表预览测试：无法区分状态、全是边缘行和空列表都不得提示配置成功。
 */
import { describe, expect, it } from 'vitest'
import { listPreviewIssue } from '../src/shared/list-preview'
import type { ListClickStep, StateListRow } from '../src/shared/types'

const selector = (value: string) => ({ kind: 'text' as const, value })
const step: ListClickStep = {
  id: 'state', type: 'listClick', mode: 'rowState', container: selector('列表'), row: selector('用户行'),
  rowDepth: 1, action: selector('关注'), completed: selector('已关注'), maxScrolls: 10, timeoutMs: 1000
}
const row = (status: StateListRow['status'], extra: Partial<StateListRow> = {}): StateListRow => ({
  index: 1, bounds: { left: 0, top: 0, right: 100, bottom: 40 }, status, ...extra
})

describe('列表只读预览', () => {
  it('空列表和所有行不完整时指出配置尚不可验证', () => {
    expect(listPreviewIssue(step, [])).toContain('未找到用户行')
    expect(listPreviewIssue(step, [row('pending', { deferred: true })])).toContain('没有可识别的完整用户行')
  })

  it('行状态含糊时返回具体原因；有完整可识别行时允许提交', () => {
    expect(listPreviewIssue(step, [row('ambiguous', { error: '待点击与完成状态同时存在' })])).toContain('待点击与完成状态同时存在')
    expect(listPreviewIssue(step, [row('missing', { error: '未识别关注或已关注状态' }), row('pending')])).toContain('未识别关注或已关注状态')
    expect(listPreviewIssue(step, [row('completed'), row('pending')])).toBeNull()
  })

  it('旧任务仍按唯一标识预览规则判断', () => {
    const identity: ListClickStep = { ...step, mode: 'identity', name: selector('昵称'), identity: selector('ID') }
    expect(listPreviewIssue(identity, [{ name: '', key: '', hasAction: false, hasCompleted: false, error: '未找到唯一标识' }])).toContain('未找到唯一标识')
    expect(listPreviewIssue(identity, [{ name: '甲', key: '1', hasAction: true, hasCompleted: false }])).toBeNull()
  })
})
