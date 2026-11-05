/**
 * 条件分支动作编辑器：维护分支内动作的顺序与独立参数。
 */
import { SwipeEditor } from './swipe-editor'
import { buildStep, draftFromStep, emptyDraft } from '../utils/branch-action-draft'
import type { ActionDraft } from '../utils/branch-action-draft'
import { ActionTimingField } from './action-timing-field'
import { useState } from 'react'
import type { BasicStep, Point, Selector } from '../../../shared/types'
import { stepSummary, stepTypeOptions, validateTask } from '../../../shared/task'

type BranchActionsProps = {
  label: string
  actions: BasicStep[]
  onChange: (actions: BasicStep[]) => void
  conditionSelector: Selector | null
  pickedSelector?: Selector | null
  onDraftChange: (isEditing: boolean) => void
}

/**
 * 编辑一个分支的动作序列，允许空分支表示跳过。
 * @param props 分支动作、条件目标与当前设备拾取结果
 * @returns 动作列表和新增或编辑表单
 */
export function BranchActions(props: BranchActionsProps) {
  const { actions, label, conditionSelector } = props
  const [draft, setDraft] = useState<ActionDraft | null>(null)
  const [error, setError] = useState('')
  const change = (part: Partial<ActionDraft>): void => setDraft((current) => current
    ? { ...current, hasRandomDelay: part.type !== undefined && part.type !== current.type ? false : current.hasRandomDelay, ...part } : current)
  const needsSelector = draft && (draft.type === 'tap' && draft.tapTarget === 'selector' || draft.type === 'input' || draft.type === 'wait' || draft.type === 'assert')

  function save(): void {
    if (!draft) return
    try {
      const action = buildStep(draft)
      validateTask({ version: 1, name: '分支动作校验', steps: [action] })
      props.onChange(actions.some((item) => item.id === action.id)
        ? actions.map((item) => item.id === action.id ? action : item)
        : [...actions, action])
      setDraft(null)
      props.onDraftChange(false)
      setError('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }

  function move(index: number, offset: number): void {
    const next = [...actions]
    const target = index + offset
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    props.onChange(next)
  }

  return <div className="condition-branch">
    <div className="condition-branch-head"><strong>{label}</strong><button type="button" onClick={() => { setDraft(emptyDraft(conditionSelector)); props.onDraftChange(true); setError('') }}>添加动作</button></div>
    {actions.length === 0 && <p className="branch-empty">无动作：跳过此分支</p>}
    {actions.map((action, index) => <div className="branch-action-row" key={action.id}>
      <span>{index + 1}. {stepSummary(action)}</span>
      <button type="button" aria-label={`编辑${label}第${index + 1}个动作`} onClick={() => { setDraft(draftFromStep(action)); props.onDraftChange(true); setError('') }}>编辑</button>
      <button type="button" aria-label={`上移${label}第${index + 1}个动作`} disabled={index === 0} onClick={() => move(index, -1)}>↑</button>
      <button type="button" aria-label={`下移${label}第${index + 1}个动作`} disabled={index === actions.length - 1} onClick={() => move(index, 1)}>↓</button>
      <button type="button" aria-label={`删除${label}第${index + 1}个动作`} onClick={() => props.onChange(actions.filter((item) => item.id !== action.id))}>×</button>
    </div>)}
    {draft && <div className="branch-draft">
      <label className="setting-field">动作<select value={draft.type} onChange={(event) => change({ type: event.target.value as BasicStep['type'] })}>
        {/* 分支只支持基础动作，排除条件和列表遍历以匹配任务校验约束 */}
        {stepTypeOptions.filter((option) => option.value !== 'condition' && option.value !== 'listClick').map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select></label>
      {draft.type === 'tap' && <label className="setting-field">点击方式<select value={draft.tapTarget} onChange={(event) => change({ tapTarget: event.target.value as ActionDraft['tapTarget'] })}><option value="selector">控件</option><option value="point">坐标</option></select></label>}
      {needsSelector && <div className="branch-target">
        <div className="branch-target-shortcuts">
          <button type="button" disabled={!conditionSelector?.value} onClick={() => change({ selector: conditionSelector })}>使用判断目标</button>
        </div>
        <label className="setting-field">定位方式<select value={draft.selector?.kind ?? 'text'} onChange={(event) => change({ selector: { kind: event.target.value as Selector['kind'], value: draft.selector?.value ?? '' } })}>
          <option value="resourceId">资源 ID</option><option value="description">描述</option><option value="text">文字</option><option value="className">类名</option>
        </select></label>
        <label className="setting-field">定位值<input value={draft.selector?.value ?? ''} onChange={(event) => change({ selector: { kind: draft.selector?.kind ?? 'text', value: event.target.value } })} /></label>
      </div>}
      {draft.type === 'tap' && draft.tapTarget === 'point' && <div>
        <PointFields label="点击坐标" point={draft.point} onChange={(point) => change({ point })} />
      </div>}
      {(draft.type === 'tap' || draft.type === 'input' || draft.type === 'wait') && <ActionTimingField label="超时（毫秒）" value={draft.timeoutMs} max={60000} onChange={(timeoutMs) => change({ timeoutMs })}
        hasRandomDelay={draft.hasRandomDelay} onRandomDelayChange={draft.type === 'wait' ? undefined : (hasRandomDelay) => change({ hasRandomDelay })} />}
      {draft.type === 'input' && <label className="setting-field">输入内容<textarea rows={3} value={draft.text} onChange={(event) => change({ text: event.target.value })} /></label>}
      {(draft.type === 'wait' || draft.type === 'assert') && <label className="setting-field">校验条件<select value={draft.exists ? 'present' : 'absent'} onChange={(event) => change({ exists: event.target.value === 'present' })}><option value="present">控件存在且唯一</option><option value="absent">控件不存在</option></select></label>}
      {draft.type === 'swipe' && <SwipeEditor hasRandomDelay={draft.hasRandomDelay} onRandomDelayChange={(hasRandomDelay) => change({ hasRandomDelay })} value={draft.swipe} onChange={(swipe) => change({ swipe })} pickedSelector={props.pickedSelector} />}
      {draft.type === 'key' && <label className="setting-field">按键<select value={draft.key} onChange={(event) => change({ key: event.target.value as ActionDraft['key'] })}><option value="back">返回</option><option value="home">Home</option></select></label>}
      {error && <p className="branch-error" role="alert">{error}</p>}
      <div className="branch-draft-actions"><button type="button" className="primary" onClick={save}>保存动作</button><button type="button" onClick={() => { setDraft(null); props.onDraftChange(false); setError('') }}>取消</button></div>
    </div>}
  </div>
}

/** 坐标点击仍沿用原有像素范围，不与比例滑动混用。 */
function PointFields({ label, point, onChange }: { label: string; point: Point; onChange: (point: Point) => void }) {
  return <div className="swipe-grid">
    <label className="setting-field">{label} X<input type="number" min="0" max="10000" value={point.x} onChange={(event) => onChange({ ...point, x: Number(event.target.value) })} /></label>
    <label className="setting-field">{label} Y<input type="number" min="0" max="10000" value={point.y} onChange={(event) => onChange({ ...point, y: Number(event.target.value) })} /></label>
  </div>
}
