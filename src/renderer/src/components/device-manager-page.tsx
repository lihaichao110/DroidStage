/**
 * 设备管理组合页：连接统计、设备表格与可收起的分步连接面板。
 */
import { useRef, useState } from 'react'
import type { BatchSummary } from '../../../shared/types'
import type { AddressRequest, DeviceFleet } from '../utils/device-manager-types'
import { DeviceTable } from './device-table'
import { DeviceConnectionPanel } from './device-connection-panel'
import { UiIcon } from './ui-icon'
import '../styles/device-manager.css'
import '../styles/device-connection.css'

type Props = { fleet: DeviceFleet; batch: BatchSummary | null; onFocus: (serial: string) => void }

/**
 * 统计使用完整会话数据，避免筛选列表改变运行目标的含义。
 * @param props 设备会话、当前批次和编辑设备选择回调
 * @returns 设备管理页面
 */
export function DeviceManagerPage({ fleet, batch, onFocus }: Props) {
  const [isPanelOpen, setPanelOpen] = useState(true)
  const [isRefreshing, setRefreshing] = useState(false)
  const [addressRequest, setAddressRequest] = useState<AddressRequest | null>(null)
  const refreshLock = useRef(false)
  const connectionButton = useRef<HTMLButtonElement>(null)
  const isRunning = Boolean(batch && !batch.finishedAt)

  /** 手动刷新使用独立锁，防止快速点击在状态更新前重复提交。 */
  async function refresh(): Promise<void> {
    if (refreshLock.current) return
    refreshLock.current = true
    setRefreshing(true)
    try { await fleet.refresh() }
    finally { refreshLock.current = false; setRefreshing(false) }
  }

  /** 版本号使重复打开同一设备也能定位地址字段。 */
  function editAddress(serial: string): void {
    setPanelOpen(true)
    setAddressRequest((current) => ({ serial, revision: (current?.revision ?? 0) + 1 }))
  }

  return <main className="page-content devices-page">
    <header className="devices-heading">
      <div className="devices-title"><h2>设备管理</h2><p>连接设备，选择本次任务的运行目标。</p></div>
      <div className="devices-counts" aria-label="设备统计">
        <span><UiIcon name="phone" size={20} />全部设备 <strong>{fleet.devices.length}</strong></span>
        <span><UiIcon name="check" size={20} />已连接 <strong>{fleet.connectedSerials.length}</strong></span>
        <span><UiIcon name="flow" size={20} />运行目标 <strong>{fleet.targets.length}</strong></span>
      </div>
      <div className="devices-heading-actions">
        <button onClick={() => void refresh()} disabled={isRefreshing} aria-busy={isRefreshing}><UiIcon name="refresh" size={18} />{isRefreshing ? '刷新中…' : '刷新设备'}</button>
        <button ref={connectionButton} className="primary" aria-controls="device-connection-panel" aria-expanded={isPanelOpen} onClick={() => setPanelOpen(true)}><UiIcon name="plug" size={19} />连接设备</button>
      </div>
    </header>
    <div className={`devices-layout${isPanelOpen ? '' : ' panel-collapsed'}`}>
      <DeviceTable fleet={fleet} batch={batch} isRunning={isRunning} isRefreshing={isRefreshing} onRefresh={() => void refresh()} onFocus={onFocus} onEditAddress={editAddress} />
      <DeviceConnectionPanel fleet={fleet} isRunning={isRunning} isOpen={isPanelOpen} isRefreshing={isRefreshing} onRefresh={() => void refresh()} onCollapse={() => { setPanelOpen(false); connectionButton.current?.focus() }} addressRequest={addressRequest} />
    </div>
  </main>
}
