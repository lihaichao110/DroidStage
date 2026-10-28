/**
 * 列表汇总测试：混合模式分别呈现次数与按身份去重的结果。
 */
import { describe, expect, it } from 'vitest'
import { listSummary, type ListTotals } from '../src/main/list-summary'

const totals: ListTotals = {
  rowSuccess: 3, rowSkipped: 2, identitySuccess: 1, identitySkipped: 1,
  identityDone: 4, hasRowState: true, hasIdentity: false
}

describe('列表运行汇总', () => {
  it('无标识模式只报告成功点击与跳过行次', () => {
    expect(listSummary(totals)).toBe('成功点击 3 次，跳过 2 行次')
  })

  it('旧模式沿用按身份的成功、跳过和原已完成统计', () => {
    expect(listSummary({ ...totals, hasRowState: false, hasIdentity: true })).toBe('成功 1，跳过 1，原已完成 4')
  })

  it('混合任务将两套统计分开，避免误称唯一用户数', () => {
    expect(listSummary({ ...totals, hasIdentity: true }))
      .toBe('按行状态：成功点击 3 次，跳过 2 行次；按唯一标识：成功 1，跳过 1，原已完成 4')
  })
})
