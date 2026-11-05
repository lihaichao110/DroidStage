/**
 * 条件步骤编辑区：配置控件定位、判断方式与两个动作分支。
 */
import { useEffect, useState } from 'react'
import type { Selector } from '../../../shared/types'
import { BranchActions } from './branch-actions'
import type { ConditionDraft } from '../hooks/use-condition-draft'

type ConditionEditorProps = {
  selector: Selector | null
  pickedSelector?: Selector | null
  onSelectorChange: (selector: Selector | null) => void
  value: ConditionDraft
  onChange: (patch: Partial<ConditionDraft>) => void
  onEditingChange: (isEditing: boolean) => void
}

/**
 * 支持手填目标：需要判断的控件可能恰好不在当前屏幕，不能强制从控件树拾取。
 * @param props 条件草稿与定位信息
 * @returns 条件设置与两个分支编辑器
 */
export function ConditionEditor(props: ConditionEditorProps) {
  const { selector, value } = props
  const { mode, repeatCount, maxChecks, intervalMs, whenPresent, whenAbsent } = value
  const selectorKind = selector?.kind ?? 'text'
  const [editing, setEditing] = useState({ present: false, absent: false })
  useEffect(() => {
    props.onEditingChange(editing.present || editing.absent)
  }, [editing.present, editing.absent, props.onEditingChange])
  useEffect(() => () => props.onEditingChange(false), [props.onEditingChange])
  return <div className="condition-editor">
    <div className="condition-target">
      <strong>判断目标</strong>
      <p>可以从左侧拾取，也可以手动填写当前不存在的控件。</p>
      <label className="setting-field">定位方式<select value={selectorKind} onChange={(event) => props.onSelectorChange({ kind: event.target.value as Selector['kind'], value: selector?.value ?? '' })}>
        <option value="resourceId">资源 ID</option><option value="description">描述</option><option value="text">文字</option><option value="className">类名</option>
      </select></label>
      <label className="setting-field">定位值<input placeholder="例如：关注" value={selector?.value ?? ''} onChange={(event) => props.onSelectorChange({ kind: selectorKind, value: event.target.value })} /></label>
    </div>
    <label className="setting-field">重复执行次数<input type="number" min="1" max="100" step="1" value={repeatCount} onChange={(event) => props.onChange({ repeatCount: Number(event.target.value) })} /></label>
    <p className="condition-hint">每次都会重新判断并执行对应分支；“最多检查次数”按每次执行分别计算。</p>
    <label className="setting-field">判断模式<select value={mode} onChange={(event) => props.onChange({ mode: event.target.value as ConditionDraft['mode'] })}>
      <option value="once">判断一次，执行对应分支后继续</option>
      <option value="repeatUntilPresent">未找到时执行分支并重新检查</option>
    </select></label>
    {mode === 'repeatUntilPresent' && <div className="swipe-grid">
      <label className="setting-field">最多检查次数<input type="number" min="1" max="100" value={maxChecks} onChange={(event) => props.onChange({ maxChecks: Number(event.target.value) })} /></label>
      <label className="setting-field">重查前等待（毫秒）<input type="number" min="100" max="60000" value={intervalMs} onChange={(event) => props.onChange({ intervalMs: Number(event.target.value) })} /></label>
    </div>}
    {mode === 'repeatUntilPresent' && <p className="condition-hint">最后一次仍未找到时，任务会报错，不再执行“不存在时”动作。</p>}
    <BranchActions label="存在时" actions={whenPresent} onChange={(steps) => props.onChange({ whenPresent: steps })} conditionSelector={selector} pickedSelector={props.pickedSelector} onDraftChange={(isEditing) => setEditing((current) => ({ ...current, present: isEditing }))} />
    <BranchActions label="不存在时" actions={whenAbsent} onChange={(steps) => props.onChange({ whenAbsent: steps })} conditionSelector={selector} pickedSelector={props.pickedSelector} onDraftChange={(isEditing) => setEditing((current) => ({ ...current, absent: isEditing }))} />
  </div>
}
