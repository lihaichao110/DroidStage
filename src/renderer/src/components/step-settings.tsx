/**
 * 步骤设置面板：编辑动作参数，并结合控件树检查拾取目标。
 */
import { useEffect, useRef, useState } from 'react'
import type { AutomationTask, BasicStep, HierarchySnapshot, Point, Selector, Step, UiNode } from '../../../shared/types'
import { stepTypeOptions } from '../../../shared/task'
import { ElementDetails } from './element-details'
import { HierarchyTree } from './hierarchy-tree'
import { ConditionEditor } from './condition-editor'
import type { StepSubmissionState } from '../hooks/use-step-submission'

type EditorAction = Step['type']
type StepSettingsProps = {
  serial: string
  task: AutomationTask
  action: EditorAction
  editingId: string | null
  text: string
  timeout: number
  exists: boolean
  conditionMode: 'once' | 'repeatUntilPresent'
  repeatCount: number
  maxChecks: number
  intervalMs: number
  whenPresent: BasicStep[]
  whenAbsent: BasicStep[]
  keyValue: 'back' | 'home'
  swipeFrom: Point
  swipeTo: Point
  swipeDuration: number
  snapshot: HierarchySnapshot | null
  selectedNode: UiNode | null
  selectedPoint: Point | null
  selector: Selector | null
  hoverNode: UiNode | null
  isConnected: boolean
  isRunning: boolean
  submission: StepSubmissionState
  onTaskChange: (task: AutomationTask) => void
  onActionChange: (action: EditorAction) => void
  onTextChange: (text: string) => void
  onTimeoutChange: (timeout: number) => void
  onExistsChange: (exists: boolean) => void
  onConditionModeChange: (mode: 'once' | 'repeatUntilPresent') => void
  onRepeatCountChange: (count: number) => void
  onMaxChecksChange: (count: number) => void
  onIntervalMsChange: (interval: number) => void
  onWhenPresentChange: (steps: BasicStep[]) => void
  onWhenAbsentChange: (steps: BasicStep[]) => void
  onKeyChange: (key: 'back' | 'home') => void
  onSwipeFromChange: (point: Point) => void
  onSwipeToChange: (point: Point) => void
  onSwipeDurationChange: (duration: number) => void
  onSelectorChange: (selector: Selector | null) => void
  onSelectNode: (node: UiNode, point: Point) => void
  onHoverNode: (node: UiNode | null) => void
  onAddStep: () => void
  onCancelEdit: () => void
}

const NO_NODES: UiNode[] = []

/**
 * 将步骤参数置于右栏；控件树保持可展开，便于选择与校验目标。
 * @param props 当前编辑参数与对应操作
 * @returns 步骤设置与元素检视区
 */
export function StepSettings(props: StepSettingsProps) {
  const [isTargetOpen, setTargetOpen] = useState(false)
  const [isBranchEditing, setBranchEditing] = useState(false)
  const elementRef = useRef<HTMLDivElement>(null)
  const { task, action, editingId, text, timeout, exists, keyValue, swipeFrom, swipeTo, swipeDuration, snapshot, selectedNode, selectedPoint, selector, hoverNode, isConnected, isRunning } = props
  const needsTarget = action === 'tap' || action === 'input' || action === 'wait' || action === 'assert' || action === 'condition'
  const isSubmitting = props.submission.phase === 'pending'
  const disabledReason = isRunning ? '任务运行中暂不能修改步骤。'
    : isBranchEditing ? '请先保存或取消正在编辑的分支动作。'
      : !isConnected && needsTarget && action !== 'condition' ? '请先连接编辑设备，再添加此类步骤。' : null
  useEffect(() => { setBranchEditing(false) }, [action, editingId])

  /** 展开定位区并滚动到可修改的控件属性。 */
  function showTarget(): void {
    setTargetOpen(true)
    requestAnimationFrame(() => elementRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
  }

  return <section className="panel settings-panel" inert={isRunning}>
    <div className="settings-head">
      <span className="settings-head-icon">⚙</span>
      <div><h2>{editingId ? '编辑步骤' : '步骤设置'}</h2><p>配置动作参数和控件定位</p></div>
    </div>
    <div className="settings-scroll">
      <div className="setting-group" inert={isSubmitting}>
        <h3>任务信息</h3>
        <label className="setting-field">任务名称<input value={task.name} onChange={(event) => props.onTaskChange({ ...task, name: event.target.value })} /></label>
        <label className="setting-field">目标 App 包名 <span className="optional">（可选）</span><input placeholder="留空则不自动启动应用" value={task.packageName ?? ''} onChange={(event) => props.onTaskChange({ ...task, packageName: event.target.value.trim() })} /></label>
      </div>
      <div className="setting-group" inert={isSubmitting}>
        <h3>动作类型</h3>
        <label className="setting-field">选择动作<select value={action} onChange={(event) => props.onActionChange(event.target.value as EditorAction)}>
          {/* 动作名称与任务流程卡、运行记录保持一致 */}
          {stepTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select></label>
        {needsTarget && <div className="target-card"><span className="target-icon">⌖</span><div><strong>{selector?.value ?? (selectedPoint ? `坐标 (${selectedPoint.x}, ${selectedPoint.y})` : '尚未选择目标')}</strong><small>{selector ? `定位方式：${selector.kind}` : '在左侧切换至拾取元素，或从下方控件树中选择'}</small></div><button onClick={showTarget}>选择</button></div>}
        {(action === 'tap' || action === 'input' || action === 'wait') && <label className="setting-field">超时（毫秒）<input type="number" min="100" max="60000" value={timeout} onChange={(event) => props.onTimeoutChange(Number(event.target.value))} /></label>}
        {action === 'input' && <label className="setting-field">输入内容<textarea rows={3} value={text} onChange={(event) => props.onTextChange(event.target.value)} /></label>}
        {(action === 'wait' || action === 'assert') && <label className="setting-field">校验条件<select value={exists ? 'present' : 'absent'} onChange={(event) => props.onExistsChange(event.target.value === 'present')}><option value="present">控件存在且唯一</option><option value="absent">控件不存在</option></select></label>}
        {action === 'condition' && <ConditionEditor key={editingId ?? 'new'}
          selector={selector} onSelectorChange={props.onSelectorChange}
          mode={props.conditionMode} onModeChange={props.onConditionModeChange}
          repeatCount={props.repeatCount} onRepeatCountChange={props.onRepeatCountChange}
          maxChecks={props.maxChecks} onMaxChecksChange={props.onMaxChecksChange}
          intervalMs={props.intervalMs} onIntervalMsChange={props.onIntervalMsChange}
          whenPresent={props.whenPresent} onWhenPresentChange={props.onWhenPresentChange}
          whenAbsent={props.whenAbsent} onWhenAbsentChange={props.onWhenAbsentChange}
          onEditingChange={setBranchEditing}
        />}
        {action === 'key' && <label className="setting-field">按键<select value={keyValue} onChange={(event) => props.onKeyChange(event.target.value as 'back' | 'home')}><option value="back">返回</option><option value="home">Home</option></select></label>}
        {action === 'swipe' && <div className="swipe-grid">
          <label className="setting-field">起点 X<input type="number" value={swipeFrom.x} onChange={(event) => props.onSwipeFromChange({ ...swipeFrom, x: Number(event.target.value) })} /></label>
          <label className="setting-field">起点 Y<input type="number" value={swipeFrom.y} onChange={(event) => props.onSwipeFromChange({ ...swipeFrom, y: Number(event.target.value) })} /></label>
          <label className="setting-field">终点 X<input type="number" value={swipeTo.x} onChange={(event) => props.onSwipeToChange({ ...swipeTo, x: Number(event.target.value) })} /></label>
          <label className="setting-field">终点 Y<input type="number" value={swipeTo.y} onChange={(event) => props.onSwipeToChange({ ...swipeTo, y: Number(event.target.value) })} /></label>
          <label className="setting-field span-two">时长（毫秒）<input type="number" value={swipeDuration} onChange={(event) => props.onSwipeDurationChange(Number(event.target.value))} /></label>
        </div>}
      </div>
      <div className="setting-submit">
        <div className="setting-actions"><button className="primary" onClick={props.onAddStep} disabled={Boolean(disabledReason) || isSubmitting} aria-busy={isSubmitting}>{isSubmitting && <span className="button-spinner" aria-hidden="true" />}{isSubmitting ? editingId ? '正在保存…' : '正在添加…' : editingId ? '保存修改' : '添加到流程'}</button>{editingId && <button onClick={props.onCancelEdit} disabled={isSubmitting}>取消修改</button>}</div>
        {disabledReason && !isSubmitting && <p className="submission-hint" role="status">{disabledReason}</p>}
        {props.submission.phase !== 'idle' && <div className={`submission-result ${props.submission.phase}`} role={props.submission.phase === 'error' ? 'alert' : 'status'}>
          {props.submission.message}
          {props.submission.phase === 'error' && props.submission.canRefineSelector && <button className="submission-link" onClick={showTarget}>修改定位条件</button>}
        </div>}
      </div>
      <div className="element-section" ref={elementRef} inert={isSubmitting}>
        <button className="element-toggle" onClick={() => setTargetOpen(!isTargetOpen)} aria-expanded={isTargetOpen}><span>⌖　元素定位与控件树</span><span>{isTargetOpen ? '⌃' : '⌄'}</span></button>
        {isTargetOpen && <div className="element-content">
          <ElementDetails serial={props.serial} node={selectedNode} selector={selector} selectedPoint={selectedPoint} isConnected={isConnected} onSelectorChange={props.onSelectorChange} />
          <HierarchyTree nodes={snapshot?.nodes ?? NO_NODES} selectedId={selectedNode?.id ?? null} hoverNode={hoverNode} onSelect={props.onSelectNode} onHoverNode={props.onHoverNode} />
        </div>}
      </div>
      <p className="settings-tip">拾取前请先连接设备并刷新控件层级；运行时会校验任务内容。</p>
    </div>
  </section>
}
