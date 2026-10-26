/**
 * 步骤提交：校验当前草稿、写入任务，并维护按钮附近的处理结果。
 */
import { useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { AutomationTask, ConditionStep, Point, Selector, Step, UiNode } from '../../../shared/types'
import { crossAppWarning, validateSelector, validateTask } from '../../../shared/task'

export type StepSubmissionState =
  | { phase: 'idle' }
  | { phase: 'pending'; message: string }
  | { phase: 'success'; message: string }
  | { phase: 'error'; message: string; canRefineSelector: boolean }

type SubmissionDraft = {
  task: AutomationTask
  setTask: Dispatch<SetStateAction<AutomationTask>>
  setEditingId: Dispatch<SetStateAction<string | null>>
  setMessage: (message: string) => void
  focused: string
  connected: boolean
  editingId: string | null
  action: Step['type']
  selector: Selector | null
  selectedNode: UiNode | null
  selectedPoint: Point | null
  text: string
  timeout: number
  exists: boolean
  keyValue: 'back' | 'home'
  swipeFrom: Point
  swipeTo: Point
  swipeDuration: number
  buildCondition: (id: string, selector: Selector) => ConditionStep
  resetCondition: () => void
}

class SelectorMatchError extends Error {}

const MIN_PENDING_MS = 180 // 即时动作也留出一帧可辨识的反馈，避免 loading 与结果在同次绘制中合并

/**
 * 提交步骤并保留失败时的草稿，使用同步引用阻止快速连点产生重复步骤。
 * @param draft 当前步骤参数和任务状态更新函数
 * @returns 提交函数、处理状态及切换草稿时的反馈清理函数
 */
export function useStepSubmission(draft: SubmissionDraft) {
  const [submission, setSubmission] = useState<StepSubmissionState>({ phase: 'idle' })
  const pendingRef = useRef(false)
  const focusedRef = useRef(draft.focused)
  focusedRef.current = draft.focused

  /** 新建或切换步骤时清除上一次提交的结果。 */
  function clearFeedback(): void {
    if (!pendingRef.current) setSubmission({ phase: 'idle' })
  }

  /** 校验并提交当前草稿；手机查询失败时保留全部输入以便修正重试。 */
  async function submit(): Promise<void> {
    if (pendingRef.current) return
    pendingRef.current = true
    const needsCount = Boolean(draft.selector) && (
      draft.action === 'tap' || draft.action === 'input' || draft.action === 'wait' ||
      draft.action === 'assert' || draft.action === 'condition' && draft.connected
    )
    setSubmission({ phase: 'pending', message: needsCount ? '正在校验控件，设备响应最多约 15 秒…' : draft.editingId ? '正在保存步骤修改…' : '正在添加步骤…' })
    try {
      const { task, editingId, action, selector, selectedPoint, focused, connected } = draft
      const id = editingId ?? crypto.randomUUID()
      let step: Step
      // 设备查询本身有 15 秒超时；本地动作短暂展示 pending，避免点击后完全没有视觉变化。
      await new Promise<void>((resolve) => setTimeout(resolve, MIN_PENDING_MS))
      if (action === 'tap') {
        if (selector) {
          const count = await window.androidAutoDesk.count(focused, selector)
          if (count !== 1) throw new SelectorMatchError(`当前定位条件匹配 ${count} 个控件，需要恰好 1 个。请更换更精确的定位方式`)
          step = { id, type: 'tap', selector, timeoutMs: draft.timeout }
        } else if (selectedPoint) {
          step = { id, type: 'tap', point: selectedPoint, timeoutMs: draft.timeout }
        } else throw new Error('先在投屏（拾取模式）或控件树中选择目标')
      } else if (action === 'input') {
        if (!selector) throw new Error('输入步骤必须选择可定位控件')
        const count = await window.androidAutoDesk.count(focused, selector)
        if (count !== 1) throw new SelectorMatchError(`当前定位条件匹配 ${count} 个控件，需要恰好 1 个。请更换更精确的定位方式`)
        step = { id, type: 'input', selector, text: draft.text, timeoutMs: draft.timeout }
      } else if (action === 'swipe') {
        step = { id, type: 'swipe', from: draft.swipeFrom, to: draft.swipeTo, durationMs: draft.swipeDuration }
      } else if (action === 'wait' || action === 'assert') {
        if (!selector) throw new Error('先选择可定位控件')
        const count = await window.androidAutoDesk.count(focused, selector)
        if (count > 1) throw new SelectorMatchError(`当前定位条件匹配 ${count} 个控件，需要更具体的定位条件`)
        step = action === 'wait' ? { id, type: 'wait', selector, exists: draft.exists, timeoutMs: draft.timeout } : { id, type: 'assert', selector, exists: draft.exists }
      } else if (action === 'condition') {
        validateSelector(selector)
        // 条件目标可以当前不存在，但多匹配会让分支结果不可靠。
        if (connected && focused) {
          const count = await window.androidAutoDesk.count(focused, selector)
          if (!Number.isInteger(count) || count < 0) throw new Error('控件匹配数量无效')
          if (count > 1) throw new SelectorMatchError(`当前定位条件匹配 ${count} 个控件，需要更具体的定位条件`)
        }
        step = draft.buildCondition(id, selector)
      } else if (action === 'screenshot') {
        step = { id, type: 'screenshot' }
      } else {
        step = { id, type: 'key', key: draft.keyValue }
      }
      if (focusedRef.current !== focused) throw new Error('编辑设备已变化，请重新校验后添加步骤')
      const next = { ...task, steps: editingId ? task.steps.map((item) => item.id === editingId ? step : item) : [...task.steps, step] }
      validateTask(next)
      draft.setTask(next)
      draft.setEditingId(null)
      draft.resetCondition()
      const success = editingId ? '步骤已修改。' : '步骤已添加到流程。'
      // 只对控件定位做跨应用提醒；坐标点击已有单独的布局风险提示。
      const warning = step.type === 'tap' && step.point ? '坐标点击可能在页面布局变化后失效。'
        : ('selector' in step && step.selector) ? crossAppWarning(draft.selectedNode?.packageName, task.packageName?.trim()) : null
      const message = warning ? `${success} ${warning}` : success
      setSubmission({ phase: 'success', message })
      draft.setMessage(message)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setSubmission({ phase: 'error', message: `${draft.editingId ? '保存修改' : '添加步骤'}失败：${message}`, canRefineSelector: error instanceof SelectorMatchError })
      draft.setMessage(message)
    } finally {
      pendingRef.current = false
    }
  }

  return { submit, submission, clearFeedback, isSubmitting: submission.phase === 'pending' }
}
