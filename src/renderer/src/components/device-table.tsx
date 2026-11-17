/**
 * 设备列表：独立滚动的筛选表格与真实运行目标选择。
 */
import { useState } from 'react'
import type { BatchSummary } from '../../../shared/types'
import { filterDevices, type DeviceFilter } from '../../../shared/device-manager-model'
import type { DeviceFleet } from '../utils/device-manager-types'
import { DeviceTableRow } from './device-table-row'
import { UiIcon } from './ui-icon'

type Props = {
  fleet: DeviceFleet; batch: BatchSummary | null; isRunning: boolean; isRefreshing: boolean
  onRefresh: () => void; onFocus: (serial: string) => void; onEditAddress: (serial: string) => void
}

/**
 * 搜索仅改变可见行，批量操作始终使用完整的已连接设备集合。
 * @param props 真实设备数据、批次与页面操作回调
 * @returns 带筛选、空状态和目标选择的表格面板
 */
export function DeviceTable({ fleet, batch, isRunning, isRefreshing, onRefresh, onFocus, onEditAddress }: Props) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<DeviceFilter>('all')
  const visible = filterDevices(fleet.devices, fleet.connectedSerials, filter, query)
  const hasDevices = fleet.devices.length > 0
  return <section className="devices-card devices-list" aria-label="设备列表">
    <div className="devices-toolbar">
      <label className="device-search"><UiIcon name="search" size={19} /><input aria-label="搜索设备" placeholder="搜索型号、序列号或 IP" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <select aria-label="筛选设备" value={filter} onChange={(event) => setFilter(event.target.value as DeviceFilter)}><option value="all">全部设备</option><option value="connected">已连接</option><option value="usb">USB</option><option value="wireless">无线</option></select>
      <div className="devices-target-actions">
        <button disabled={isRunning || !fleet.connectedSerials.length} onClick={() => fleet.selectTargets(fleet.connectedSerials)}><UiIcon name="check" size={16} />全选已连接</button>
        <button disabled={isRunning || !fleet.targets.length} onClick={() => fleet.selectTargets([])}><UiIcon name="trash" size={16} />清空目标</button>
      </div>
    </div>
    <div className="devices-table-scroll" tabIndex={0} aria-label="设备表格，可滚动">
      <table className="devices-table">
        <thead><tr><th scope="col">目标</th><th scope="col">设备</th><th scope="col">方式</th><th scope="col">设备状态</th><th scope="col">连接状态</th><th scope="col">任务</th><th scope="col">操作</th></tr></thead>
        <tbody>{visible.map((device) => <DeviceTableRow key={device.serial} device={device} fleet={fleet} batch={batch} isRunning={isRunning} onFocus={onFocus} onEditAddress={onEditAddress} />)}</tbody>
      </table>
      {!visible.length && <div className="devices-empty">
        <UiIcon name={hasDevices ? 'search' : 'phone'} size={38} />
        <h3>{hasDevices ? '没有符合条件的设备' : '尚未发现设备'}</h3>
        <p>{hasDevices ? '试试其他关键词，或清除筛选查看全部设备。' : '通过 USB 连接手机并完成调试授权，或使用右侧连接引导。'}</p>
        {hasDevices ? <button onClick={() => { setQuery(''); setFilter('all') }}>清除筛选</button> : <button disabled={isRefreshing} onClick={onRefresh}><UiIcon name="refresh" size={17} />{isRefreshing ? '刷新中…' : '刷新设备'}</button>}
      </div>}
    </div>
    <div className="devices-list-foot"><UiIcon name="info" size={17} />{isRunning ? '任务运行中，暂不能更改运行目标。' : '仅已连接设备可选为运行目标'}</div>
  </section>
}
