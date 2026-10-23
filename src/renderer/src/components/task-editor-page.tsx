/**
 * 任务编辑页：保留单台设备拾取与三栏编辑，运行目标由设备管理页独立选择。
 */
import { useEffect, useRef, useState } from 'react'
import type { AutomationTask, BatchRecord, Device, HierarchySnapshot, Point, Selector, Step, UiNode } from '../../../shared/types'
import { crossAppWarning, suggestedSelector, validateSelector, validateTask } from '../../../shared/task'
import { InspectorPanel } from './inspector-panel'
import { WorkflowPanel } from './workflow-panel'
import { StepSettings } from './step-settings'
import { useTaskActions } from '../hooks/use-task-actions'
import { useConditionDraft } from '../hooks/use-condition-draft'

type EditorAction = Step['type']
const defaultTask: AutomationTask = { version: 1, name: '新任务', packageName: '', steps: [] }

type TaskEditorPageProps = {
  active: boolean
  devices: Device[]
  connectedSerials: string[]
  focused: string
  targets: string[]
  running: boolean
  setFocused: (serial: string) => void
  setMessage: (message: string) => void
  onShowDevices: () => void
  onBatchStarted: (batch: BatchRecord) => void
}

export function TaskEditorPage({ active, devices, connectedSerials, focused, targets, running, setFocused, setMessage, onShowDevices, onBatchStarted }: TaskEditorPageProps) {
  const connected = connectedSerials.includes(focused)
  const [snapshot, setSnapshot] = useState<HierarchySnapshot | null>(null)
  const [selectedNode, setSelectedNode] = useState<UiNode | null>(null)
  const [hoverNode, setHoverNode] = useState<UiNode | null>(null)
  const [selectedPoint, setSelectedPoint] = useState<Point | null>(null)
  const [selector, setSelector] = useState<Selector | null>(null)
  const [task, setTask] = useState<AutomationTask>(defaultTask)
  const [action, setAction] = useState<EditorAction>('tap')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [timeout, setTimeoutValue] = useState(10000)
  const [exists, setExists] = useState(true)
  const conditionDraft = useConditionDraft()
  const [key, setKey] = useState<'back' | 'home'>('back')
  const [swipeFrom, setSwipeFrom] = useState<Point>({ x: 300, y: 700 })
  const [swipeTo, setSwipeTo] = useState<Point>({ x: 300, y: 300 })
  const [swipeDuration, setSwipeDuration] = useState(500)
  const [busy, setBusy] = useState(false)
  const [runReview, setRunReview] = useState<'run' | 'save-run' | null>(null)
  const focusedRef = useRef(focused)
  focusedRef.current = focused

  useEffect(() => {
    setSnapshot(null)
    setSelectedNode(null)
    setSelectedPoint(null)
    setSelector(null)
    // 切换编辑设备后必须重取层级，旧设备的控件坐标不能沿用。
  }, [focused])
  useEffect(() => {
    if (active && connected && !running) void refreshSnapshot()
    // 页签重新进入时恢复当前设备的控件层级。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused, active, connected, running])
  useEffect(() => { if (!active) setRunReview(null) }, [active])

  // 新快照后旧节点的边界可能已失效，清除投屏与控件树间的悬浮联动。
  useEffect(() => { setHoverNode(null) }, [snapshot])

  async function refreshSnapshot(): Promise<void> {
    try {
      if (!focused) throw new Error('请先选择编辑设备')
      setBusy(true)
      const result = await window.androidAutoDesk.snapshot(focused)
      if (focusedRef.current !== focused) return
      setSnapshot(result)
      setSelectedNode(null)
      setSelectedPoint(null)
      setSelector(null)
      // 包名留空时用当前前台应用的包名回填（控件树第一个根节点的 package 属性），
      // 录制时用户通常停在目标 App 界面，自动填入可省去手查包名；回填后给出提示，用户可清空改为不启动 App
      const foreground = result.nodes.find((node) => node.depth === 0 && node.packageName)?.packageName
      const isBackfilled = Boolean(foreground && !task.packageName)
      if (foreground) setTask((current) => current.packageName ? current : { ...current, packageName: foreground })
      setMessage(isBackfilled
        ? `已读取 ${result.nodes.length} 个控件；已自动填入当前前台应用：${foreground}（留空则运行时不启动 App）`
        : `已读取 ${result.nodes.length} 个控件。`)
    } catch (error) { setMessage(errorText(error)) }
    finally { setBusy(false) }
  }

  function selectNode(node: UiNode | null, point: Point | null): void {
    setSelectedNode(node)
    setSelectedPoint(point)
    setSelector(node ? suggestedSelector(node, snapshot?.nodes ?? []) : null)
  }

  async function addStep(): Promise<void> {
    try {
      const id = editingId ?? crypto.randomUUID()
      let step: Step
      if (action === 'tap') {
        if (selector) {
          const count = await window.androidAutoDesk.count(focused, selector)
          if (count !== 1) throw new Error(`当前定位条件匹配 ${count} 个控件，需要恰好 1 个`)
          step = { id, type: 'tap', selector, timeoutMs: timeout }
        } else if (selectedPoint) {
          step = { id, type: 'tap', point: selectedPoint, timeoutMs: timeout }
          setMessage('已添加坐标点击。页面布局变化时可能失效。')
        } else throw new Error('先在投屏（拾取模式）或控件树中选择目标')
      } else if (action === 'input') {
        if (!selector) throw new Error('输入步骤必须选择可定位控件')
        const count = await window.androidAutoDesk.count(focused, selector)
        if (count !== 1) throw new Error(`当前定位条件匹配 ${count} 个控件，需要恰好 1 个`)
        step = { id, type: 'input', selector, text, timeoutMs: timeout }
      } else if (action === 'swipe') {
        step = { id, type: 'swipe', from: swipeFrom, to: swipeTo, durationMs: swipeDuration }
      } else if (action === 'wait' || action === 'assert') {
        if (!selector) throw new Error('先选择可定位控件')
        const count = await window.androidAutoDesk.count(focused, selector)
        if (count > 1) throw new Error(`当前定位条件匹配 ${count} 个控件，需要更具体的定位条件`)
        step = action === 'wait' ? { id, type: 'wait', selector, exists, timeoutMs: timeout } : { id, type: 'assert', selector, exists }
      } else if (action === 'condition') {
        validateSelector(selector)
        // 条件目标可以当前不存在，但已出现多个匹配时必须先改进定位方式。
        if (connected && focused) {
          const count = await window.androidAutoDesk.count(focused, selector)
          if (!Number.isInteger(count) || count < 0) throw new Error('控件匹配数量无效')
          if (count > 1) throw new Error(`当前定位条件匹配 ${count} 个控件，需要更具体的定位条件`)
        }
        step = conditionDraft.build(id, selector)
      } else if (action === 'screenshot') {
        step = { id, type: 'screenshot' }
      } else {
        step = { id, type: 'key', key }
      }
      const next = { ...task, steps: editingId ? task.steps.map((item) => item.id === editingId ? step : item) : [...task.steps, step] }
      validateTask(next)
      setTask(next)
      setEditingId(null)
      if (action === 'condition') conditionDraft.reset()
      // 只对按控件定位的步骤做跨应用提醒：坐标点击已有布局变化风险提示，swipe/key/screenshot 不涉及控件归属
      const warning = ('selector' in step && step.selector) ? crossAppWarning(selectedNode?.packageName, task.packageName?.trim()) : null
      if (warning) setMessage(warning)
      else if (action !== 'tap' || selector) setMessage(editingId ? '步骤已修改。' : '步骤已添加。')
    } catch (error) { setMessage(errorText(error)) }
  }

  function editStep(step: Step): void {
    setEditingId(step.id)
    setAction(step.type)
    setSelectedNode(null)
    setSelector('selector' in step ? step.selector ?? null : null)
    setSelectedPoint(step.type === 'tap' ? step.point ?? null : null)
    if ('timeoutMs' in step) setTimeoutValue(step.timeoutMs)
    if (step.type === 'input') setText(step.text)
    if (step.type === 'wait' || step.type === 'assert') setExists(step.exists)
    if (step.type === 'condition') conditionDraft.load(step)
    if (step.type === 'swipe') { setSwipeFrom(step.from); setSwipeTo(step.to); setSwipeDuration(step.durationMs) }
    if (step.type === 'key') setKey(step.key)
    setMessage('正在修改步骤；选择新控件可替换原定位条件。')
  }

  function moveStep(index: number, offset: number): void {
    const target = index + offset
    if (target < 0 || target >= task.steps.length) return
    const steps = [...task.steps]
      ;[steps[index], steps[target]] = [steps[target], steps[index]]
    setTask({ ...task, steps })
  }
  function startNewStep(): void {
    setEditingId(null)
    conditionDraft.reset()
    setMessage('在右侧配置新步骤。')
  }
  const { save, load, run, saveAndRun } = useTaskActions({ task, setTask, setEditingId, setMessage, targets, onBatchStarted })

  return <div className={`editor-page${active ? '' : ' page-hidden'}`}>
    <div className="editor-toolbar">
      <div className="editor-title"><h2>{task.name || '未命名任务'}</h2><span>{task.steps.length} 个步骤</span></div>
      <label className="editor-device">编辑设备
        <select value={focused} onChange={(event) => setFocused(event.target.value)} disabled={busy || running}>
          {!connectedSerials.length && <option value="">无已连接设备</option>}
          {devices.filter((device) => connectedSerials.includes(device.serial)).map((device) => <option key={device.serial} value={device.serial}>{device.model || device.serial} · {device.serial}</option>)}
        </select>
      </label>
      <button className="target-summary" onClick={onShowDevices}>运行目标 {targets.length} 台 · 选择</button>
      <div className="editor-actions"><button onClick={() => void load()} disabled={running}>打开任务</button><button onClick={() => void save()} disabled={running}>保存任务</button><button onClick={() => setRunReview('run')} disabled={!targets.length || running || !task.steps.length || Boolean(editingId)}>运行</button><button className="primary" onClick={() => setRunReview('save-run')} disabled={!targets.length || running || !task.steps.length || Boolean(editingId)}>保存并运行</button></div>
    </div>

    {active && <main className="workspace">
      <InspectorPanel
        serial={focused}
        snapshot={snapshot}
        selectedNode={selectedNode}
        hoverNode={hoverNode}
        isConnected={connected}
        isBusy={busy}
        isTaskRunning={running}
        onRefresh={() => void refreshSnapshot()}
        onSelect={selectNode}
        onHoverNode={setHoverNode}
      />
      <WorkflowPanel
        task={task}
        activeStepId={editingId}
        isRunning={running}
        onTaskChange={setTask}
        onNewStep={startNewStep}
        onEditStep={editStep}
        onMoveStep={moveStep}
      />
      <StepSettings
        serial={focused}
        task={task}
        action={action}
        editingId={editingId}
        text={text}
        timeout={timeout}
        exists={exists}
        conditionMode={conditionDraft.mode}
        maxChecks={conditionDraft.maxChecks}
        intervalMs={conditionDraft.intervalMs}
        whenPresent={conditionDraft.whenPresent}
        whenAbsent={conditionDraft.whenAbsent}
        keyValue={key}
        swipeFrom={swipeFrom}
        swipeTo={swipeTo}
        swipeDuration={swipeDuration}
        snapshot={snapshot}
        selectedNode={selectedNode}
        selectedPoint={selectedPoint}
        selector={selector}
        hoverNode={hoverNode}
        isConnected={connected}
        isRunning={running}
        onTaskChange={setTask}
        onActionChange={setAction}
        onTextChange={setText}
        onTimeoutChange={setTimeoutValue}
        onExistsChange={setExists}
        onConditionModeChange={conditionDraft.setMode}
        onMaxChecksChange={conditionDraft.setMaxChecks}
        onIntervalMsChange={conditionDraft.setIntervalMs}
        onWhenPresentChange={conditionDraft.setWhenPresent}
        onWhenAbsentChange={conditionDraft.setWhenAbsent}
        onKeyChange={setKey}
        onSwipeFromChange={setSwipeFrom}
        onSwipeToChange={setSwipeTo}
        onSwipeDurationChange={setSwipeDuration}
        onSelectorChange={setSelector}
        onSelectNode={selectNode}
        onHoverNode={setHoverNode}
        onAddStep={() => void addStep()}
        onCancelEdit={startNewStep}
      />
    </main>}
    {runReview && active && <div className="modal-backdrop" role="presentation" onClick={() => setRunReview(null)}>
      <section className="run-review" role="dialog" aria-modal="true" aria-label="核对运行目标" onClick={(event) => event.stopPropagation()}>
        <h3>核对运行目标</h3><p>任务“{task.name}”将独立并行运行在以下 {targets.length} 台设备：</p>
        <ul>{targets.map((serial) => <li key={serial}>{devices.find((device) => device.serial === serial)?.model || '设备'} <small>{serial}</small></li>)}</ul>
        <div className="review-actions"><button onClick={() => setRunReview(null)}>返回</button><button className="primary" onClick={() => { const action = runReview === 'save-run' ? saveAndRun : run; setRunReview(null); void action() }}>确认运行</button></div>
      </section>
    </div>}
  </div>
}

function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error) }
