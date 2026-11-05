/**
 * 步骤提交：校验当前草稿、写入任务，并维护按钮附近的处理结果。
 */
import { useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { AutomationTask, ConditionStep, ListClickStep, Point, Selector, Step, UiNode } from '../../../shared/types'
import { crossAppWarning, validateSelector, validateTask } from '../../../shared/task'
import { listPreviewIssue } from '../../../shared/list-preview'
import type { StepDraft } from '../utils/step-draft'

export type StepSubmissionState =
  | { phase: 'idle' }
  | { phase: 'pending'; message: string }
  | { phase: 'success'; message: string }
  | { phase: 'error'; message: string; canRefineSelector: boolean }

/** 当前拾取结果：与草稿分离维护，提交成功后仍保留，便于连续添加同类步骤。 */
type StepPick = {
  selector: Selector | null
  selectedNode: UiNode | null
  selectedPoint: Point | null
}

type SubmissionDeps = {
  task: AutomationTask
  setTask: Dispatch<SetStateAction<AutomationTask>>
  setMessage: (message: string) => void
  focused: string
  connected: boolean
  draft: StepDraft
  pick: StepPick
  buildCondition: (id: string, selector: Selector) => ConditionStep
  buildList: (id: string) => ListClickStep
  /** 提交成功后由页面退出编辑态并重置条件、列表子草稿。 */
  onDone: () => void
}

class SelectorMatchError extends Error {}

const MIN_PENDING_MS = 180 // 即时动作也留出一帧可辨识的反馈，避免 loading 与结果在同次绘制中合并

/**
 * 提交步骤并保留失败时的草稿，使用同步引用阻止快速连点产生重复步骤。
 * @param deps 步骤草稿、拾取结果与任务状态更新函数
 * @returns 提交函数、处理状态及切换草稿时的反馈清理函数
 */
export function useStepSubmission(deps: SubmissionDeps) {
  const [submission, setSubmission] = useState<StepSubmissionState>({ phase: 'idle' })
  const pendingRef = useRef(false)
  const focusedRef = useRef(deps.focused)
  focusedRef.current = deps.focused

  /** 新建或切换步骤时清除上一次提交的结果。 */
  function clearFeedback(): void {
    if (!pendingRef.current) setSubmission({ phase: 'idle' })
  }

  /** 校验并提交当前草稿；手机查询失败时保留全部输入以便修正重试。 */
  async function submit(): Promise<void> {
    if (pendingRef.current) return
    pendingRef.current = true
    const { task, focused, connected, draft, pick } = deps
    const { editingId, action, timeoutMs, text, exists, key: keyValue, swipeFrom, swipeTo, swipeDurationMs } = draft
    const { selector, selectedNode, selectedPoint } = pick
    const needsCount = Boolean(selector) && (
      action === 'tap' || action === 'input' || action === 'wait' ||
      action === 'assert' || action === 'condition' && connected
    )
    setSubmission({ phase: 'pending', message: needsCount ? '正在校验控件，设备响应最多约 15 秒…' : editingId ? '正在保存步骤修改…' : '正在添加步骤…' })
    try {
      const id = editingId ?? crypto.randomUUID()
      let step: Step
      // 设备查询本身有 15 秒超时；本地动作短暂展示 pending，避免点击后完全没有视觉变化。
      await new Promise<void>((resolve) => setTimeout(resolve, MIN_PENDING_MS))
      if (action === 'tap') {
        if (selector) {
          const count = await window.androidAutoDesk.count(focused, selector)
          if (count !== 1) throw new SelectorMatchError(`当前定位条件匹配 ${count} 个控件，需要恰好 1 个。请更换更精确的定位方式`)
          step = { id, type: 'tap', selector, timeoutMs }
        } else if (selectedPoint) {
          step = { id, type: 'tap', point: selectedPoint, timeoutMs }
        } else throw new Error('先在投屏（拾取模式）或控件树中选择目标')
      } else if (action === 'input') {
        if (!selector) throw new Error('输入步骤必须选择可定位控件')
        const count = await window.androidAutoDesk.count(focused, selector)
        if (count !== 1) throw new SelectorMatchError(`当前定位条件匹配 ${count} 个控件，需要恰好 1 个。请更换更精确的定位方式`)
        step = { id, type: 'input', selector, text, timeoutMs }
      } else if (action === 'swipe') {
        step = { id, type: 'swipe', from: swipeFrom, to: swipeTo, durationMs: swipeDurationMs }
      } else if (action === 'wait' || action === 'assert') {
        if (!selector) throw new Error('先选择可定位控件')
        const count = await window.androidAutoDesk.count(focused, selector)
        if (count > 1) throw new SelectorMatchError(`当前定位条件匹配 ${count} 个控件，需要更具体的定位条件`)
        step = action === 'wait' ? { id, type: 'wait', selector, exists, timeoutMs } : { id, type: 'assert', selector, exists }
      } else if (action === 'condition') {
        validateSelector(selector)
        // 条件目标可以当前不存在，但多匹配会让分支结果不可靠。
        if (connected && focused) {
          const count = await window.androidAutoDesk.count(focused, selector)
          if (!Number.isInteger(count) || count < 0) throw new Error('控件匹配数量无效')
          if (count > 1) throw new SelectorMatchError(`当前定位条件匹配 ${count} 个控件，需要更具体的定位条件`)
        }
        step = deps.buildCondition(id, selector)
      } else if (action === 'listClick') {
        const candidate = deps.buildList(id)
        validateTask({ version: 1, name: task.name || '列表校验', steps: [candidate] })
        if (!connected || !focused) throw new Error('请先连接编辑设备')
        const rows = await window.androidAutoDesk.previewList(focused, candidate)
        const issue = listPreviewIssue(candidate, rows)
        if (issue) throw new Error(issue)
        step = candidate
      } else if (action === 'screenshot') {
        step = { id, type: 'screenshot' }
      } else {
        step = { id, type: 'key', key: keyValue }
      }
      if (focusedRef.current !== focused) throw new Error('编辑设备已变化，请重新校验后添加步骤')
      const next = { ...task, steps: editingId ? task.steps.map((item) => item.id === editingId ? step : item) : [...task.steps, step] }
      validateTask(next)
      deps.setTask(next)
      deps.onDone()
      const success = editingId ? '步骤已修改。' : '步骤已添加到流程。'
      // 只对控件定位做跨应用提醒；坐标点击已有单独的布局风险提示。
      const warning = step.type === 'tap' && step.point ? '坐标点击可能在页面布局变化后失效。'
        : ('selector' in step && step.selector) ? crossAppWarning(selectedNode?.packageName, task.packageName?.trim()) : null
      const message = warning ? `${success} ${warning}` : success
      setSubmission({ phase: 'success', message })
      deps.setMessage(message)
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error)
      // 超时多为设备瞬时繁忙（控件树刷新、动画重绘），给出可操作指引而不是裸错误
      const message = raw.includes('操作超时') ? `${raw}。设备响应缓慢，请稍等几秒后重试` : raw
      setSubmission({ phase: 'error', message: `${editingId ? '保存修改' : '添加步骤'}失败：${message}`, canRefineSelector: error instanceof SelectorMatchError })
      deps.setMessage(message)
    } finally {
      pendingRef.current = false
    }
  }

  return { submit, submission, clearFeedback, isSubmitting: submission.phase === 'pending' }
}
