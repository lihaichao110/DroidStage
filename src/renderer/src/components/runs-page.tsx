/**
 * 运行记录页：按批次与设备展示独立执行进度、事件和结果目录。
 */
import { useState } from 'react'
import type { BatchRecord, DeviceRunStatus } from '../../../shared/types'

type Props = { batch: BatchRecord | null; history: BatchRecord[]; onCancel: (serial?: string) => void; onOpenResult: (directory: string) => void }

export function RunsPage({ batch, history, onCancel, onOpenResult }: Props) {
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null)
  const [selectedSerial, setSelectedSerial] = useState<string | null>(null)
  const records = batch ? [batch, ...history.filter((item) => item.id !== batch.id)] : history
  const record = records.find((item) => item.id === selectedBatchId) ?? records[0]
  const device = record?.devices.find((item) => item.serial === selectedSerial) ?? record?.devices[0]
  const currentAction = record?.events.filter((event) => event.serial === device?.serial && (event.kind === 'start' || event.kind === 'step')).at(-1)?.message
  const resultMessage = record?.events.filter((event) => event.serial === device?.serial && (event.kind === 'success' || event.kind === 'partial' || event.kind === 'failure' || event.kind === 'cancelled')).at(-1)?.message
  const isActive = Boolean(record && batch?.id === record.id && !record.finishedAt)
  const done = record?.devices.filter((item) => !['pending', 'running'].includes(item.status)).length ?? 0

  return <main className="page-content runs-page">
    <div className="page-heading"><div><h2>运行记录</h2><p>每台设备独立推进，单台失败不会停止其他设备。</p></div>{isActive && <button onClick={() => onCancel()}>完成当前步骤后取消整批</button>}</div>
    {!record ? <div className="page-card runs-empty">暂无运行记录。请在任务编辑页选择目标并启动任务。</div> : <div className="runs-layout">
      <section className="page-card run-current">
        <div className="run-batch-head"><div><h3>{record.taskName}</h3><small>{new Date(record.startedAt).toLocaleString()} · {record.devices.length} 台设备</small></div><span className={`state-pill ${isActive ? 'warn' : 'ok'}`}>{isActive ? '运行中' : '已结束'}</span></div>
        <div className="run-progress"><div><strong>{done} / {record.devices.length}</strong><span>台已完成</span></div><progress value={done} max={record.devices.length} /></div>
        <div className="run-device-list">{record.devices.map((item) => <button key={item.serial} className={device?.serial === item.serial ? 'active' : ''} onClick={() => setSelectedSerial(item.serial)}><span>{item.serial}</span><b className={`run-${item.status}`}>{statusText(item.status)}</b></button>)}</div>
      </section>
      <section className="page-card run-detail">
        {device && <><div className="run-detail-head"><div><h3>{device.serial}</h3><p>{device.error || (device.status === 'running' ? currentAction || '正在启动任务' : resultMessage || statusText(device.status))}</p></div><div className="run-detail-actions">{isActive && (device.status === 'pending' || device.status === 'running') && <button onClick={() => onCancel(device.serial)}>取消此设备</button>}{device.runDir && <button onClick={() => onOpenResult(device.runDir!)}>打开结果目录</button>}</div></div>
          <div className="run-event-list" role="log">{record.events.filter((event) => event.serial === device.serial).map((event, index) => <div key={`${event.at}-${index}`} className={`run-event run-${event.kind}`}><time>{new Date(event.at).toLocaleTimeString()}</time><span>{event.message}</span></div>)}{!record.events.some((event) => event.serial === device.serial) && <p>等待设备开始运行…</p>}</div>
        </>}
      </section>
      <section className="page-card run-history"><h3>历史批次</h3><div>{records.map((item) => <button key={item.id} className={record.id === item.id ? 'active' : ''} onClick={() => { setSelectedBatchId(item.id); setSelectedSerial(null) }}><strong>{item.taskName}</strong><small>{new Date(item.startedAt).toLocaleString()} · {item.devices.length} 台 · {item.finishedAt ? '已结束' : '运行中'}</small></button>)}</div></section>
    </div>}
  </main>
}

function statusText(status: DeviceRunStatus): string {
  return { pending: '待运行', running: '运行中', success: '成功', partial: '部分完成', failure: '失败', cancelled: '已取消' }[status]
}
