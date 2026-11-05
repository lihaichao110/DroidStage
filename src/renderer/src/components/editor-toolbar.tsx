/**
 * 任务编辑页工具栏：任务标题、编辑设备选择与任务级操作按钮。
 */
import type { AutomationTask, Device } from '../../../shared/types'

type EditorToolbarProps = {
  task: AutomationTask
  focused: string
  devices: Device[]
  connectedSerials: string[]
  targets: string[]
  /** 层级刷新中，仅锁定设备选择。 */
  busy: boolean
  running: boolean
  isSubmitting: boolean
  /** 运行按钮统一判定：目标与步骤就绪、未在运行且不在修改步骤。 */
  canRun: boolean
  onFocusedChange: (serial: string) => void
  onShowDevices: () => void
  onLoad: () => void
  onSave: () => void
  onRun: () => void
  onSaveAndRun: () => void
}

/**
 * 组合标题、设备选择与四个任务级按钮；禁用条件集中在此处便于核对。
 * @param props 任务信息与操作回调
 * @returns 编辑页顶部工具栏
 */
export function EditorToolbar(props: EditorToolbarProps) {
  const { task, focused, devices, connectedSerials, targets, busy, running, isSubmitting, canRun } = props
  // 任务级操作在运行或提交期间一律锁定，避免半途改写任务内容
  const locked = running || isSubmitting
  return <div className="editor-toolbar">
    <div className="editor-title"><h2>{task.name || '未命名任务'}</h2><span>{task.steps.length} 个步骤</span></div>
    <label className="editor-device">编辑设备
      <select value={focused} onChange={(event) => props.onFocusedChange(event.target.value)} disabled={busy || locked}>
        {!connectedSerials.length && <option value="">无已连接设备</option>}
        {devices.filter((device) => connectedSerials.includes(device.serial)).map((device) => <option key={device.serial} value={device.serial}>{device.model || device.serial} · {device.serial}</option>)}
      </select>
    </label>
    <button className="target-summary" onClick={props.onShowDevices} disabled={isSubmitting}>运行目标 {targets.length} 台 · 选择</button>
    <div className="editor-actions">
      <button onClick={props.onLoad} disabled={locked}>打开任务</button>
      <button onClick={props.onSave} disabled={locked}>保存任务</button>
      <button onClick={props.onRun} disabled={!canRun}>运行</button>
      <button className="primary" onClick={props.onSaveAndRun} disabled={!canRun}>保存并运行</button>
    </div>
  </div>
}
