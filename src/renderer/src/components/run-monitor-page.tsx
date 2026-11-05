/**
 * 运行工作台：把批次状态、按需投屏和逐设备日志汇于同一页面。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { BatchSummary, Device, PendingRun, RunEvent } from '../../../shared/types'
import { monitorCounts, monitorRows, pendingPreviewSerials, preferredMonitorSerial, STATUS_LABELS, type MonitorFilter } from '../../../shared/monitor-model'
import { MonitorDeviceList } from './monitor-device-list'
import { MonitorPreview } from './monitor-preview'
import { MonitorDetail } from './monitor-detail'
import { usePendingRun } from '../hooks/use-pending-run'

type Props = {
  batch: BatchSummary | null
  devices: Device[]
  connectedSerials: string[]
  pendingRun: PendingRun | null
  onRunLaunched: (batch: BatchSummary) => void
  onRunLaunchFailed: (message: string) => void
  onPendingCancel: () => void
  onCancel: (serial?: string) => void
  onOpenResult: (directory: string) => void
  onError: (message: string) => void
}

const COUNT_ORDER = ['pending', 'running', 'success', 'partial', 'failure', 'cancelled'] as const

/**
 * 工作台默认追踪新启动的批次；切到历史批次时停止全部实时投屏。
 * @param props 当前批次、设备及操作回调
 * @returns 可监看大量设备的工作页面
 */
export function RunMonitorPage({ batch, devices, connectedSerials, pendingRun, onRunLaunched, onRunLaunchFailed, onPendingCancel, onCancel, onOpenResult, onError }: Props) {
  const [history, setHistory] = useState<BatchSummary[]>([])
  const [nextPage, setNextPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [isLoadingHistory, setLoadingHistory] = useState(false)
  const [selectedBatchId, setSelectedBatchId] = useState(batch?.id ?? 'live')
  // 准备期直接锚定首要监看设备，让详情与画面从第一秒就对准将开跑的设备
  const [selectedSerial, setSelectedSerial] = useState(pendingRun ? pendingRun.primary : preferredMonitorSerial(batch))
  const [pinnedSerials, setPinnedSerials] = useState<string[]>([])
  const [scope, setScope] = useState<'batch' | 'all'>(batch ? 'batch' : 'all')
  const [filter, setFilter] = useState<MonitorFilter>('all')
  const [query, setQuery] = useState('')
  const [events, setEvents] = useState<RunEvent[]>([])
  const [isLoadingEvents, setLoadingEvents] = useState(false)
  const [eventError, setEventError] = useState('')
  const [now, setNow] = useState(Date.now())
  const lastBatchId = useRef(batch?.id ?? '')

  // 历史只按页读取摘要；当前批次完成后重新载入首页，避免读取所有旧日志。
  useEffect(() => {
    let cancelled = false
    setLoadingHistory(true)
    void window.androidAutoDesk.listBatches(0).then((page) => {
      if (cancelled) return
      // 刷新首页时保留已翻出的旧批次，避免用户正在查看的历史项突然消失。
      setHistory((current) => {
        const fresh = new Set(page.items.map((item) => item.id))
        return [...page.items, ...current.filter((item) => !fresh.has(item.id))]
      })
      setHasMore(page.hasMore)
      setNextPage(1)
    }).catch((error) => { if (!cancelled) onError(errorText(error)) })
      .finally(() => { if (!cancelled) setLoadingHistory(false) })
    return () => { cancelled = true }
  }, [batch?.id, batch?.finishedAt, onError])

  useEffect(() => {
    if (!batch || lastBatchId.current === batch.id) return
    // 页面先于批次摘要加载时，也自动定位到最近批次；用户之后仍可主动切换监看范围。
    lastBatchId.current = batch.id
    setSelectedBatchId(batch.id)
  }, [batch?.id])

  const records = useMemo(() => batch ? [batch, ...history.filter((item) => item.id !== batch.id)] : history, [batch, history])
  const record = selectedBatchId === 'live' ? null : records.find((item) => item.id === selectedBatchId) ?? null
  const isHistory = Boolean(record?.finishedAt || record && record.id !== batch?.id)
  const isActive = Boolean(record && record.id === batch?.id && !record.finishedAt)

  // 只有批次切换才重置选择；排序、筛选和进度更新都不得抢走当前设备。
  // 准备期保持锚定首要设备，待任务真正建立（准备态清空）后再按批次定位。
  useEffect(() => {
    if (pendingRun) return
    setScope(record ? 'batch' : 'all')
    setSelectedSerial(record ? preferredMonitorSerial(record) : connectedSerials[0] ?? '')
    setPinnedSerials([])
  }, [selectedBatchId, record?.id, pendingRun])
  useEffect(() => {
    if (selectedBatchId === 'live' && selectedSerial && !connectedSerials.includes(selectedSerial)) {
      setSelectedSerial(connectedSerials[0] ?? '')
    } else if (selectedBatchId === 'live' && !selectedSerial && connectedSerials.length) {
      setSelectedSerial(connectedSerials[0])
    }
  }, [connectedSerials, selectedBatchId, selectedSerial])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  // 准备编排：首要设备出画面（或失败/超时）后任务才真正下发；照常运行的提示走底部状态栏
  const isLaunching = usePendingRun(pendingRun, connectedSerials, {
    onLaunched: onRunLaunched,
    onLaunchFailed: onRunLaunchFailed,
    onNotice: onError
  })

  // 先订阅增量事件再取历史；取数期间到达的事件按内容去重合并，避免丢日志。
  useEffect(() => {
    if (!record || !selectedSerial) { setEvents([]); setEventError(''); setLoadingEvents(false); return }
    let cancelled = false
    let loaded = false
    const queued: RunEvent[] = []
    setEvents([])
    setEventError('')
    setLoadingEvents(true)
    const off = window.androidAutoDesk.onRunEvent((event) => {
      if (event.batchId !== record.id || event.serial !== selectedSerial || cancelled) return
      if (loaded) setEvents((current) => [...current, event])
      else queued.push(event)
    })
    void window.androidAutoDesk.batchEvents(record.id, selectedSerial).then((initial) => {
      if (cancelled) return
      const seen = new Map<string, number>()
      for (const event of initial) {
        const key = eventKey(event)
        seen.set(key, (seen.get(key) ?? 0) + 1)
      }
      const missing = queued.filter((event) => {
        const key = eventKey(event)
        const count = seen.get(key) ?? 0
        if (count) { seen.set(key, count - 1); return false }
        return true
      })
      setEvents([...initial, ...missing])
      loaded = true
    }).catch((error) => {
      if (cancelled) return
      setEventError(errorText(error))
      // 磁盘读取失败后仍保留订阅期间的新事件，便于继续排查当前设备。
      setEvents([...queued])
      loaded = true
    })
      .finally(() => { if (!cancelled) setLoadingEvents(false) })
    return () => { cancelled = true; off() }
  }, [record?.id, selectedSerial])

  const rows = monitorRows(record, devices, connectedSerials, scope, filter, query)
  const allRows = monitorRows(record, devices, connectedSerials, scope, 'all', '')
  const selectedRow = allRows.find((row) => row.serial === selectedSerial) ?? null
  const run = record?.devices.find((item) => item.serial === selectedSerial) ?? null
  // 准备期画面固定为目标设备（首要置顶，最多 4 路），不随选中/固定状态变化，保证开跑前就能看到它们建流
  const previewSerials = pendingRun
    ? pendingPreviewSerials(pendingRun.targets, pendingRun.primary)
    : isHistory ? [] : [selectedSerial, ...pinnedSerials.filter((serial) => serial !== selectedSerial)].filter(Boolean)
  const counts = monitorCounts(record)
  const elapsed = record ? Math.max(0, Math.floor(((record.finishedAt ? Date.parse(record.finishedAt) : now) - Date.parse(record.startedAt)) / 1000)) : 0

  async function loadMore(): Promise<void> {
    if (!hasMore || isLoadingHistory) return
    setLoadingHistory(true)
    try {
      const page = await window.androidAutoDesk.listBatches(nextPage)
      setHistory((current) => {
        const known = new Set(current.map((item) => item.id))
        return [...current, ...page.items.filter((item) => !known.has(item.id))]
      })
      setHasMore(page.hasMore)
      setNextPage((current) => current + 1)
    } catch (error) { onError(errorText(error)) }
    finally { setLoadingHistory(false) }
  }

  function togglePin(serial: string): void {
    setPinnedSerials((current) => current.includes(serial) ? current.filter((item) => item !== serial)
      : current.length < 3 && connectedSerials.includes(serial) ? [...current, serial] : current)
  }

  return <main className="page-content monitor-page">
    <div className="monitor-heading">
      <div><h2>运行工作台</h2><p>{record ? `${record.taskName} · ${record.devices.length} 台目标 · 已运行 ${formatDuration(elapsed)}` : `已连接 ${connectedSerials.length} 台设备，选择设备查看实时画面。`}</p></div>
      <div className="monitor-batch-actions">
        <label>查看批次<select aria-label="查看批次" value={selectedBatchId} onChange={(event) => setSelectedBatchId(event.target.value)}>
          <option value="live">已连接设备监看</option>
          {records.map((item) => <option key={item.id} value={item.id}>{item.taskName} · {new Date(item.startedAt).toLocaleString()}</option>)}
        </select></label>
        {hasMore && <button onClick={() => void loadMore()} disabled={isLoadingHistory}>加载更多历史</button>}
        {isActive && <button onClick={() => onCancel()}>完成当前步骤后取消整批</button>}
      </div>
    </div>
    {pendingRun && <div className="monitor-pending" role="status">
      <span className="pending-dot" aria-hidden="true" />
      <span>{isLaunching ? '画面已就绪，任务启动中…' : '正在建立投屏，画面就绪后任务自动开始'}</span>
      <button onClick={onPendingCancel} disabled={isLaunching}>取消运行</button>
    </div>}
    {record && <div className="monitor-counts" aria-label="批次状态统计">
      {COUNT_ORDER.map((status) => <span key={status} className={`monitor-count run-${status}`}><b>{counts[status]}</b>{STATUS_LABELS[status]}</span>)}
    </div>}
    <div className="monitor-layout">
      <MonitorDeviceList rows={rows} selectedSerial={selectedSerial} pinnedSerials={pinnedSerials} scope={scope} filter={filter} query={query}
        hasBatch={Boolean(record)} canPin={pinnedSerials.length < 3} showPin={!isHistory} onScope={setScope} onFilter={setFilter} onQuery={setQuery} onSelect={setSelectedSerial} onTogglePin={togglePin} />
      <MonitorPreview serials={previewSerials} devices={devices} connectedSerials={connectedSerials} pinnedSerials={pinnedSerials}
        selectedSerial={selectedSerial} isHistory={isHistory && !pendingRun} onUnpin={togglePin} />
      <MonitorDetail row={selectedRow} run={run} events={events} loading={isLoadingEvents} error={eventError} isActive={isActive}
        onCancel={onCancel} onOpenResult={onOpenResult} />
    </div>
  </main>
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor(seconds % 3600 / 60)
  const rest = seconds % 60
  return hours ? `${hours}时${minutes}分${rest}秒` : minutes ? `${minutes}分${rest}秒` : `${rest}秒`
}

function eventKey(event: RunEvent): string {
  return `${event.at}\u0000${event.kind}\u0000${event.stepIndex ?? ''}\u0000${event.message}`
}

function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error) }
