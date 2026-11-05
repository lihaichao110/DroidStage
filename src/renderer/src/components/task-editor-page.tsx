/**
 * 任务编辑页：保留单台设备拾取与三栏编辑，运行目标由设备管理页独立选择。
 */
import { useEffect, useRef, useState } from 'react'
import type { AutomationTask, Device, HierarchySnapshot, Point, Selector, Step, UiNode } from '../../../shared/types'
import { suggestedSelector } from '../../../shared/task'
import { InspectorPanel } from './inspector-panel'
import { WorkflowPanel } from './workflow-panel'
import { StepSettings } from './step-settings'
import { EditorToolbar } from './editor-toolbar'
import { RunReviewDialog } from './run-review-dialog'
import { useStepDraft } from '../hooks/use-step-draft'
import { useTaskActions } from '../hooks/use-task-actions'
import { useStepSubmission } from '../hooks/use-step-submission'
import { useConditionDraft } from '../hooks/use-condition-draft'
import { useListClickDraft } from '../hooks/use-list-click-draft'

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
  onRunPrepared: (task: AutomationTask, targets: string[]) => void
}

export function TaskEditorPage({ active, devices, connectedSerials, focused, targets, running, setFocused, setMessage, onShowDevices, onRunPrepared }: TaskEditorPageProps) {
  const connected = connectedSerials.includes(focused)
  // 页面级状态：拾取结果与任务本体，草稿之外的一切
  const [snapshot, setSnapshot] = useState<HierarchySnapshot | null>(null)
  const [selectedNode, setSelectedNode] = useState<UiNode | null>(null)
  const [hoverNode, setHoverNode] = useState<UiNode | null>(null)
  const [selectedPoint, setSelectedPoint] = useState<Point | null>(null)
  const [selector, setSelector] = useState<Selector | null>(null)
  const [task, setTask] = useState<AutomationTask>(defaultTask)
  const [busy, setBusy] = useState(false)
  const [runReview, setRunReview] = useState<'run' | 'save-run' | null>(null)
  // 步骤草稿三件套：通用字段 + 条件/列表子草稿
  const { draft, update: updateDraft, loadStep } = useStepDraft()
  const conditionDraft = useConditionDraft()
  const listDraft = useListClickDraft()
  const focusedRef = useRef(focused)
  focusedRef.current = focused
  const { submit, submission, clearFeedback, isSubmitting } = useStepSubmission({
    task, setTask, setMessage, focused, connected,
    draft,
    pick: { selector, selectedNode, selectedPoint },
    buildCondition: conditionDraft.build,
    buildList: listDraft.build,
    // 提交成功后退出编辑态；保留已填参数便于连续添加同类步骤
    onDone: () => { updateDraft({ editingId: null }); conditionDraft.reset(); listDraft.reset() }
  })

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
    clearFeedback()
    setSelectedNode(node)
    setSelectedPoint(point)
    setSelector(node ? suggestedSelector(node, snapshot?.nodes ?? []) : null)
  }

  function editStep(step: Step): void {
    clearFeedback()
    // 通用字段（id、动作、参数）整体回填，无关字段在 draftFromStep 内回落默认值
    loadStep(step)
    setSelectedNode(null)
    setSelector('selector' in step ? step.selector ?? null : null)
    setSelectedPoint(step.type === 'tap' ? step.point ?? null : null)
    if (step.type === 'condition') conditionDraft.load(step)
    else conditionDraft.reset()
    if (step.type === 'listClick') listDraft.load(step)
    else listDraft.reset()
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
    clearFeedback()
    updateDraft({ editingId: null })
    conditionDraft.reset()
    listDraft.reset()
    setMessage('在右侧配置新步骤。')
  }

  const { save, load, run, saveAndRun } = useTaskActions({
    task, setTask, setMessage,
    onTaskLoaded: () => { updateDraft({ editingId: null }); conditionDraft.reset(); listDraft.reset() },
    targets, onRunPrepared
  })
  const canRun = targets.length > 0 && task.steps.length > 0 && draft.editingId === null && !running && !isSubmitting

  return <div className={`editor-page${active ? '' : ' page-hidden'}`}>
    <EditorToolbar
      task={task} focused={focused} devices={devices} connectedSerials={connectedSerials}
      targets={targets} busy={busy} running={running} isSubmitting={isSubmitting} canRun={canRun}
      onFocusedChange={setFocused} onShowDevices={onShowDevices}
      onLoad={() => void load()} onSave={() => void save()}
      onRun={() => setRunReview('run')} onSaveAndRun={() => setRunReview('save-run')}
    />
    {active && <main className="workspace">
      <InspectorPanel
        serial={focused}
        snapshot={snapshot}
        selectedNode={selectedNode}
        hoverNode={hoverNode}
        isConnected={connected}
        isBusy={busy}
        isTaskRunning={running}
        isSubmitting={isSubmitting}
        onRefresh={() => void refreshSnapshot()}
        onSelect={selectNode}
        onHoverNode={setHoverNode}
      />
      <WorkflowPanel
        task={task}
        activeStepId={draft.editingId}
        isRunning={running || isSubmitting}
        onTaskChange={setTask}
        onNewStep={startNewStep}
        onEditStep={editStep}
        onMoveStep={moveStep}
      />
      <StepSettings
        serial={focused}
        task={task}
        onTaskChange={setTask}
        draft={draft}
        onDraftChange={(patch) => { clearFeedback(); updateDraft(patch) }}
        condition={conditionDraft.value}
        onConditionChange={conditionDraft.update}
        listValue={listDraft.value}
        onListChange={listDraft.update}
        snapshot={snapshot}
        selectedNode={selectedNode}
        selectedPoint={selectedPoint}
        selector={selector}
        hoverNode={hoverNode}
        onSelectorChange={(next) => { clearFeedback(); setSelector(next) }}
        onSelectNode={selectNode}
        onHoverNode={setHoverNode}
        isConnected={connected}
        isRunning={running}
        submission={submission}
        onAddStep={() => void submit()}
        onCancelEdit={startNewStep}
      />
    </main>}
    {runReview && active && <RunReviewDialog
      task={task} devices={devices} targets={targets}
      onCancel={() => setRunReview(null)}
      onConfirm={() => { const action = runReview === 'save-run' ? saveAndRun : run; setRunReview(null); void action() }}
    />}
  </div>
}

function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error) }
