/**
 * 运行前核对弹窗：列出全部运行目标，确认后才下发任务。
 */
import type { AutomationTask, Device } from '../../../shared/types'

type RunReviewDialogProps = {
  task: AutomationTask
  devices: Device[]
  targets: string[]
  onCancel: () => void
  onConfirm: () => void
}

/**
 * 点遮罩关闭、点卡片不冒泡；确认动作（运行或保存并运行）由调用方区分。
 * @param props 任务与运行目标信息
 * @returns 核对运行目标的模态弹窗
 */
export function RunReviewDialog({ task, devices, targets, onCancel, onConfirm }: RunReviewDialogProps) {
  return <div className="modal-backdrop" role="presentation" onClick={onCancel}>
    <section className="run-review" role="dialog" aria-modal="true" aria-label="核对运行目标" onClick={(event) => event.stopPropagation()}>
      <h3>核对运行目标</h3>
      <p>任务“{task.name}”将独立并行运行在以下 {targets.length} 台设备：</p>
      <ul>{targets.map((serial) => <li key={serial}>{devices.find((device) => device.serial === serial)?.model || '设备'} <small>{serial}</small></li>)}</ul>
      <div className="review-actions"><button onClick={onCancel}>返回</button><button className="primary" onClick={onConfirm}>确认运行</button></div>
    </section>
  </div>
}
