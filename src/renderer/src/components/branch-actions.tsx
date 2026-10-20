/**
 * 条件分支动作编辑器：维护分支内动作的顺序与独立参数。
 */
import { useState } from 'react'
import type { BasicStep, Point, Selector } from '../../../shared/types'
import { stepTypeName, validateTask } from '../../../shared/task'

type BranchActionsProps = {
  label: string
  actions: BasicStep[]
  onChange: (actions: BasicStep[]) => void
  conditionSelector: Selector | null
  onDraftChange: (isEditing: boolean) => void
}

type ActionDraft = {
  id: string
  type: BasicStep['type']
  selector: Selector | null
  tapTarget: 'selector' | 'point'
  point: Point
  text: string
  timeoutMs: number
  from: Point
  to: Point
  durationMs: number
  exists: boolean
  key: 'back' | 'home'
}

/** 分支草稿使用已有条件目标，便于把“存在时”直接配置为点击该控件。 */
function emptyDraft(selector: Selector | null): ActionDraft {
  return {
    id: crypto.randomUUID(), type: 'tap', selector, tapTarget: 'selector', point: { x: 300, y: 500 },
    text: '', timeoutMs: 10000, from: { x: 300, y: 700 }, to: { x: 300, y: 300 },
    durationMs: 500, exists: true, key: 'back'
  }
}

/** 从已有动作恢复表单参数，编辑后保留原 ID 与其他分支动作顺序。 */
function draftFromStep(step: BasicStep): ActionDraft {
  const draft = emptyDraft('selector' in step ? step.selector ?? null : null)
  draft.id = step.id
  draft.type = step.type
  if (step.type === 'tap') {
    draft.tapTarget = step.point ? 'point' : 'selector'
    draft.point = step.point ?? draft.point
  }
  if ('timeoutMs' in step) draft.timeoutMs = step.timeoutMs
  if (step.type === 'input') draft.text = step.text
  if (step.type === 'swipe') { draft.from = step.from; draft.to = step.to; draft.durationMs = step.durationMs }
  if (step.type === 'wait' || step.type === 'assert') draft.exists = step.exists
  if (step.type === 'key') draft.key = step.key
  return draft
}

/** 将表单草稿转成与顶层动作相同的数据结构，仍由共享校验器检查。 */
function buildStep(draft: ActionDraft): BasicStep {
  const { id, type, selector, timeoutMs } = draft
  switch (type) {
    case 'tap': return draft.tapTarget === 'point'
      ? { id, type, point: draft.point, timeoutMs }
      : { id, type, selector: selector ?? undefined, timeoutMs }
    case 'input': return { id, type, selector: selector!, text: draft.text, timeoutMs }
    case 'swipe': return { id, type, from: draft.from, to: draft.to, durationMs: draft.durationMs }
    case 'wait': return { id, type, selector: selector!, exists: draft.exists, timeoutMs }
    case 'assert': return { id, type, selector: selector!, exists: draft.exists }
    case 'screenshot': return { id, type }
    case 'key': return { id, type, key: draft.key }
  }
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
  const change = (part: Partial<ActionDraft>): void => setDraft((current) => current ? { ...current, ...part } : current)
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
      <span>{index + 1}. {stepTypeName(action.type)}{action.type === 'tap' && action.selector ? ` · ${action.selector.value}` : ''}</span>
      <button type="button" aria-label={`编辑${label}第${index + 1}个动作`} onClick={() => { setDraft(draftFromStep(action)); props.onDraftChange(true); setError('') }}>编辑</button>
      <button type="button" aria-label={`上移${label}第${index + 1}个动作`} disabled={index === 0} onClick={() => move(index, -1)}>↑</button>
      <button type="button" aria-label={`下移${label}第${index + 1}个动作`} disabled={index === actions.length - 1} onClick={() => move(index, 1)}>↓</button>
      <button type="button" aria-label={`删除${label}第${index + 1}个动作`} onClick={() => props.onChange(actions.filter((item) => item.id !== action.id))}>×</button>
    </div>)}
    {draft && <div className="branch-draft">
      <label className="setting-field">动作<select value={draft.type} onChange={(event) => change({ type: event.target.value as BasicStep['type'] })}>
        <option value="tap">点击</option><option value="input">输入文本</option><option value="swipe">滑动</option><option value="wait">等待控件</option><option value="assert">断言控件</option><option value="screenshot">保存截图</option><option value="key">返回 / Home</option>
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
      {(draft.type === 'tap' || draft.type === 'input' || draft.type === 'wait') && <label className="setting-field">超时（毫秒）<input type="number" min="100" max="60000" value={draft.timeoutMs} onChange={(event) => change({ timeoutMs: Number(event.target.value) })} /></label>}
      {draft.type === 'input' && <label className="setting-field">输入内容<textarea rows={3} value={draft.text} onChange={(event) => change({ text: event.target.value })} /></label>}
      {(draft.type === 'wait' || draft.type === 'assert') && <label className="setting-field">校验条件<select value={draft.exists ? 'present' : 'absent'} onChange={(event) => change({ exists: event.target.value === 'present' })}><option value="present">控件存在且唯一</option><option value="absent">控件不存在</option></select></label>}
      {draft.type === 'swipe' && <>
        <PointFields label="滑动起点" point={draft.from} onChange={(from) => change({ from })} />
        <PointFields label="滑动终点" point={draft.to} onChange={(to) => change({ to })} />
        <label className="setting-field">滑动时长（毫秒）<input type="number" min="100" max="10000" value={draft.durationMs} onChange={(event) => change({ durationMs: Number(event.target.value) })} /></label>
      </>}
      {draft.type === 'key' && <label className="setting-field">按键<select value={draft.key} onChange={(event) => change({ key: event.target.value as ActionDraft['key'] })}><option value="back">返回</option><option value="home">Home</option></select></label>}
      {error && <p className="branch-error" role="alert">{error}</p>}
      <div className="branch-draft-actions"><button type="button" className="primary" onClick={save}>保存动作</button><button type="button" onClick={() => { setDraft(null); props.onDraftChange(false); setError('') }}>取消</button></div>
    </div>}
  </div>
}

/** 复用坐标输入，避免滑动和点击的坐标范围出现不同校验。 */
function PointFields({ label, point, onChange }: { label: string; point: Point; onChange: (point: Point) => void }) {
  return <div className="swipe-grid">
    <label className="setting-field">{label} X<input type="number" min="0" max="10000" value={point.x} onChange={(event) => onChange({ ...point, x: Number(event.target.value) })} /></label>
    <label className="setting-field">{label} Y<input type="number" min="0" max="10000" value={point.y} onChange={(event) => onChange({ ...point, y: Number(event.target.value) })} /></label>
  </div>
}
