/**
 * 任务文件与运行操作：集中处理校验、保存取消和执行状态。
 */
import type { Dispatch, SetStateAction } from 'react'
import type { AutomationTask, BatchRecord } from '../../../shared/types'
import { validateTask } from '../../../shared/task'

type TaskActionsState = {
  task: AutomationTask
  setTask: Dispatch<SetStateAction<AutomationTask>>
  setEditingId: Dispatch<SetStateAction<string | null>>
  setMessage: (message: string) => void
  onTaskLoaded: () => void
  targets: string[]
  onBatchStarted: (batch: BatchRecord) => void
}

/**
 * 为当前任务创建文件与运行操作；用户取消保存对话框时，保存并运行会停止。
 * @param state 当前任务及状态更新函数
 * @returns 保存、载入、运行与组合操作
 */
export function useTaskActions({ task, setTask, setEditingId, setMessage, onTaskLoaded, targets, onBatchStarted }: TaskActionsState) {
  /** 保存任务，并在校验失败时显示错误。 */
  async function save(): Promise<void> {
    try {
      validateTask(task)
      const file = await window.androidAutoDesk.saveTask(task)
      if (file) setMessage(`已保存：${file}`)
    } catch (error) { setMessage(errorText(error)) }
  }

  /** 载入任务后退出旧步骤的编辑状态。 */
  async function load(): Promise<void> {
    try {
      const result = await window.androidAutoDesk.loadTask()
      if (result) { setTask(result); setEditingId(null); onTaskLoaded(); setMessage('任务已载入。') }
    } catch (error) { setMessage(errorText(error)) }
  }

  /** 清空旧记录并运行已校验的任务。 */
  async function run(): Promise<void> {
    try {
      validateTask(task)
      if (!task.steps.length) throw new Error('请先添加至少一个步骤')
      if (!targets.length) throw new Error('请先选择运行目标设备')
      const batch = await window.androidAutoDesk.runTask(task, targets)
      onBatchStarted(batch)
      setMessage(`任务已开始运行：${targets.length} 台设备。`)
    } catch (error) { setMessage(errorText(error)) }
  }

  /** 保存成功后运行；取消文件对话框时不启动任务。 */
  async function saveAndRun(): Promise<void> {
    try {
      validateTask(task)
      if (!task.steps.length) throw new Error('请先添加至少一个步骤')
      const file = await window.androidAutoDesk.saveTask(task)
      if (!file) return
      setMessage(`已保存：${file}`)
      await run()
    } catch (error) { setMessage(errorText(error)) }
  }

  return { save, load, run, saveAndRun }
}

function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error) }
