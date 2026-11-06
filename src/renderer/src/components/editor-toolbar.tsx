/**
 * 任务工具栏：集中常用文件操作，并通过可键盘访问的折叠菜单保留独立运行。
 */
import { useEffect, useRef } from 'react'
import type { AutomationTask } from '../../../shared/types'
import { UiIcon } from './ui-icon'

type EditorToolbarProps = {
  task: AutomationTask
  targets: string[]
  running: boolean
  isSubmitting: boolean
  canRun: boolean
  onShowDevices: () => void
  onLoad: () => void
  onSave: () => void
  onRun: () => void
  onSaveAndRun: () => void
}

/**
 * 文件操作在提交和运行期间锁定，独立运行与保存并运行使用同一就绪条件。
 * @param props 任务摘要、可运行状态及操作回调
 * @returns 工具栏与更多操作浮层
 */
export function EditorToolbar(props: EditorToolbarProps) {
  const { task, targets, running, isSubmitting, canRun } = props
  const menuRef = useRef<HTMLDetailsElement>(null)
  const locked = running || isSubmitting

  useEffect(() => {
    /** 点击外部关闭菜单，不吞掉原目标的点击。 */
    function closeOutside(event: PointerEvent): void {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) menuRef.current.open = false
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [])
  useEffect(() => { if (locked && menuRef.current) menuRef.current.open = false }, [locked])

  return <div className="editor-toolbar">
    <div className="editor-title" title={task.name || '未命名任务'}><UiIcon name="file" /><h2>{task.name || '未命名任务'}</h2><span>· {task.steps.length} 个步骤</span></div>
    <div className="editor-actions">
      <button onClick={props.onLoad} disabled={locked}><UiIcon name="folder" size={20} />打开任务</button>
      <button onClick={props.onSave} disabled={locked}><UiIcon name="save" size={20} />保存任务</button>
      <span className="toolbar-divider" aria-hidden="true" />
      <button className="primary" onClick={props.onSaveAndRun} disabled={!canRun}><UiIcon name="play" size={19} />保存并运行</button>
      <details className="task-more" ref={menuRef} onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.open = false
      }} onKeyDown={(event) => {
        if (event.key === 'Escape' && menuRef.current) {
          menuRef.current.open = false
          menuRef.current.querySelector('summary')?.focus()
        }
      }}>
        <summary aria-label="更多任务操作" title="更多任务操作"><UiIcon name="more" /></summary>
        <div className="task-more-menu"><button disabled={!canRun} onClick={() => { if (menuRef.current) menuRef.current.open = false; props.onRun() }}><UiIcon name="play" size={17} />运行任务（不保存）</button></div>
      </details>
    </div>
    <button className="target-summary" onClick={props.onShowDevices} disabled={isSubmitting}><UiIcon name="phone" size={16} />运行目标 {targets.length} 台<UiIcon name="down" size={14} /></button>
  </div>
}
