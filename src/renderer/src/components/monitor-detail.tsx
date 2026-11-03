/**
 * 运行工作台设备详情：显示所选设备的步骤、异常、逐条日志与处理入口。
 */
import type { DeviceRun, RunEvent } from '../../../shared/types'
import type { MonitorRow } from '../../../shared/monitor-model'
import { STATUS_LABELS } from '../../../shared/monitor-model'

type Props = {
  row: MonitorRow | null
  run: DeviceRun | null
  events: RunEvent[]
  loading: boolean
  error: string
  isActive: boolean
  onCancel: (serial: string) => void
  onOpenResult: (directory: string) => void
}

/** 所选设备即使被列表筛选隐藏，也继续展示对应详情。 */
export function MonitorDetail({ row, run, events, loading, error, isActive, onCancel, onOpenResult }: Props) {
  const latest = events.at(-1)
  return <section className="page-card monitor-detail" aria-label="设备详情">
    <div className="monitor-panel-head"><h3>设备详情</h3></div>
    {!row ? <p className="monitor-empty">选择一台设备查看执行详情。</p> : <>
      <div className="monitor-detail-summary">
        <strong>{row.model}</strong><small>{row.serial}</small>
        <span className={`run-${row.status}`}>{STATUS_LABELS[row.status]}{run?.stepIndex === undefined ? '' : ` · 第 ${run.stepIndex + 1} 步`}</span>
        {!row.connected && <p className="monitor-detail-warning">设备已断开，无法查看实时画面。</p>}
        {run?.error && <p className="monitor-detail-error">{run.error}</p>}
        {!run?.error && latest && <p>{latest.message}</p>}
        <div className="monitor-detail-actions">
          {isActive && run && (run.status === 'pending' || run.status === 'running') && <button onClick={() => onCancel(row.serial)}>取消此设备</button>}
          {run?.runDir && <button onClick={() => onOpenResult(run.runDir!)}>打开结果目录</button>}
        </div>
      </div>
      <div className="monitor-log-head">执行日志</div>
      <div className="monitor-log" role="log">
        {loading && <p>正在读取日志…</p>}
        {error && <p className="monitor-detail-error">{error}</p>}
        {!loading && !error && !events.length && <p>{run ? '暂无执行事件。' : '此设备未参与所选批次。'}</p>}
        {events.map((event, index) => <div className={`monitor-event run-${event.kind}`} key={`${event.at}-${index}`}><time>{new Date(event.at).toLocaleTimeString()}</time><span>{event.message}</span></div>)}
      </div>
    </>}
  </section>
}
