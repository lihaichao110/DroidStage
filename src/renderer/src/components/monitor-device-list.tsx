/**
 * 运行工作台设备列表：集中筛选大量目标，并明确当前画面与固定画面。
 */
import type { MonitorFilter, MonitorRow } from '../../../shared/monitor-model'
import { STATUS_LABELS } from '../../../shared/monitor-model'

type Props = {
  rows: MonitorRow[]
  selectedSerial: string
  pinnedSerials: string[]
  scope: 'batch' | 'all'
  filter: MonitorFilter
  query: string
  hasBatch: boolean
  canPin: boolean
  showPin: boolean
  onScope: (scope: 'batch' | 'all') => void
  onFilter: (filter: MonitorFilter) => void
  onQuery: (query: string) => void
  onSelect: (serial: string) => void
  onTogglePin: (serial: string) => void
}

/** 展示状态优先的设备列表；筛选不会清除上层当前选择。 */
export function MonitorDeviceList(props: Props) {
  const { rows, selectedSerial, pinnedSerials, scope, filter, query, hasBatch, canPin, showPin,
    onScope, onFilter, onQuery, onSelect, onTogglePin } = props
  return <section className="page-card monitor-roster" aria-label="设备列表">
    <div className="monitor-panel-head"><h3>设备</h3><span>{rows.length} 台符合条件</span></div>
    <div className="monitor-filters">
      <div className="monitor-scope" role="group" aria-label="设备范围">
        <button className={scope === 'batch' ? 'active' : ''} disabled={!hasBatch} onClick={() => onScope('batch')}>当前批次</button>
        <button className={scope === 'all' ? 'active' : ''} onClick={() => onScope('all')}>全部已连接</button>
      </div>
      <input aria-label="搜索监看设备" placeholder="搜索型号或序列号" value={query} onChange={(event) => onQuery(event.target.value)} />
      <select aria-label="筛选运行状态" value={filter} onChange={(event) => onFilter(event.target.value as MonitorFilter)}>
        <option value="all">全部状态</option>
        {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </div>
    <div className="monitor-roster-scroll">
      {rows.map((row) => {
        const pinned = pinnedSerials.includes(row.serial)
        return <div key={row.serial} className={`monitor-device-row${selectedSerial === row.serial ? ' selected' : ''}`}>
          <button className="monitor-device-select" onClick={() => onSelect(row.serial)} aria-pressed={selectedSerial === row.serial}>
            <span className="monitor-device-top"><strong>{row.model}</strong><b className={`run-${row.status}`}>{STATUS_LABELS[row.status]}</b></span>
            <small>{row.serial}</small>
            <span className="monitor-device-meta">{row.stepIndex === undefined ? '' : `第 ${row.stepIndex + 1} 步 · `}{row.connected ? '已连接' : '设备已断开'}</span>
            {row.error && <span className="monitor-device-error" title={row.error}>{row.error}</span>}
          </button>
          {showPin && <button className="monitor-pin" title={pinned ? '取消固定画面' : canPin ? '固定画面' : '最多固定三台设备'} aria-label={`${pinned ? '取消固定' : '固定'} ${row.serial}`} disabled={!pinned && (!canPin || !row.connected)} onClick={() => onTogglePin(row.serial)}>{pinned ? '★' : '☆'}</button>}
        </div>
      })}
      {!rows.length && <p className="monitor-empty">没有符合条件的设备。</p>}
    </div>
  </section>
}
