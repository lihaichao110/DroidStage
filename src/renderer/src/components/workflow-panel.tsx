/**
 * 任务流程面板：按执行顺序展示步骤，并提供编辑、排序与运行记录。
 */
import type { AutomationTask, Step } from '../../../shared/types'
import { flowStepNumber, stepDetail, stepTitle } from '../../../shared/task'

type WorkflowPanelProps = {
  task: AutomationTask
  activeStepId: string | null
  isRunning: boolean
  onTaskChange: (task: AutomationTask) => void
  onNewStep: () => void
  onEditStep: (step: Step) => void
  onMoveStep: (index: number, offset: number) => void
}

const STEP_META: Record<Step['type'], { icon: string; help: string }> = {
  tap: { icon: '⌖', help: '点击页面中的目标控件或坐标' },
  input: { icon: '⌨', help: '向选中的输入框填写内容' },
  swipe: { icon: '↕', help: '从起点滑动到终点' },
  wait: { icon: '◷', help: '等待目标控件出现或消失' },
  assert: { icon: '✓', help: '核验目标控件的存在状态' },
  condition: { icon: '◇', help: '按控件存在状态执行不同动作' },
  listClick: { icon: '↧', help: '逐行点击未完成的用户并滚动到末尾' },
  screenshot: { icon: '▣', help: '保存当前设备画面' },
  key: { icon: '↶', help: '向设备发送返回或 Home' }
}

/**
 * 用可编辑的流程卡片承载真实任务步骤，并展示条件步骤的重复次数。
 * @param props 任务状态与操作回调
 * @returns 任务流程及运行记录
 */
export function WorkflowPanel({ task, activeStepId, isRunning, onTaskChange, onNewStep, onEditStep, onMoveStep }: WorkflowPanelProps) {
  return <section className="panel workflow-panel" inert={isRunning}>
    <div className="panel-head workflow-head">
      <div><h2>任务流程</h2><p>按顺序执行下方步骤</p></div>
      <button className="outline-blue" onClick={onNewStep} disabled={isRunning}><span className="button-plus">＋</span> 添加步骤</button>
    </div>
    <div className="workflow-scroll">
      <div className="flow-list">
        {task.packageName && <div className="flow-row">
          <span className="flow-number">1</span>
          <div className="flow-card launch-card">
            <span className="flow-icon">▦</span>
            <div className="flow-copy"><strong>打开应用</strong><small>任务开始时启动目标 Android 应用</small><div className="flow-detail"><span>应用包名</span><b>{task.packageName}</b></div></div>
          </div>
        </div>}
        {task.steps.length === 0 && <div className="flow-empty">
          <span className="flow-empty-icon">＋</span>
          <strong>还没有任务步骤</strong>
          <p>在右侧选择动作，使用设备预览拾取目标，然后添加步骤。</p>
          <button className="outline-blue" onClick={onNewStep}>添加第一个步骤</button>
        </div>}
        {task.steps.map((step, index) => {
          const meta = STEP_META[step.type]
          return <div className="flow-row" key={step.id}>
            <span className={`flow-number${activeStepId === step.id ? ' selected' : ''}`}>{flowStepNumber(index, task.packageName)}</span>
            <div className={`flow-card${activeStepId === step.id ? ' selected' : ''}`}>
              <span className="flow-icon">{meta.icon}</span>
              <div className="flow-copy"><strong>{stepTitle(step.type)}</strong><small>{meta.help}</small><div className="flow-detail"><span>步骤目标</span><b>{stepDetail(step)}</b></div>
                {step.type === 'condition' && (step.repeatCount ?? 1) > 1 && <small>重复执行 {step.repeatCount} 次</small>}
                {step.type === 'condition' && <div className="flow-branches">
                  <span>存在时：{branchDetail(step.whenPresent)}</span>
                  <span>不存在时：{branchDetail(step.whenAbsent)}{step.mode === 'repeatUntilPresent' ? '，然后重新检查' : ''}</span>
                </div>}
              </div>
              <div className="flow-actions">
                <button title="编辑步骤" aria-label={`编辑步骤 ${index + 1}`} onClick={() => onEditStep(step)} disabled={isRunning}>⋯</button>
                <div className="flow-menu">
                  <button title="上移" aria-label={`上移步骤 ${index + 1}`} onClick={() => onMoveStep(index, -1)} disabled={index === 0 || isRunning}>↑</button>
                  <button title="下移" aria-label={`下移步骤 ${index + 1}`} onClick={() => onMoveStep(index, 1)} disabled={index === task.steps.length - 1 || isRunning}>↓</button>
                  <button title="删除" aria-label={`删除步骤 ${index + 1}`} onClick={() => onTaskChange({ ...task, steps: task.steps.filter((item) => item.id !== step.id) })} disabled={isRunning}>×</button>
                </div>
              </div>
            </div>
          </div>
        })}
      </div>
    </div>
  </section>
}

/** 按执行顺序概览分支动作，空分支明确显示为跳过。 */
function branchDetail(actions: Exclude<Step, { type: 'condition' | 'listClick' }>[]): string {
  return actions.length ? actions.map((action) => `${stepTitle(action.type)} · ${stepDetail(action)}`).join(' → ') : '跳过'
}
