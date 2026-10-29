/**
 * 设备管理页：发现、筛选、逐台连接设备并选择任务运行目标。
 */
import { useState } from 'react'
import type { BatchRecord, Device } from '../../../shared/types'
import type { useDeviceFleet } from '../hooks/use-device-fleet'

type Fleet = ReturnType<typeof useDeviceFleet>
type Props = { fleet: Fleet; batch: BatchRecord | null; onFocus: (serial: string) => void }

export function DeviceManagerPage({ fleet, batch, onFocus }: Props) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'connected' | 'usb' | 'wireless'>('all')
  const [pairAddress, setPairAddress] = useState('')
  const [pairCode, setPairCode] = useState('')
  const [connectAddress, setConnectAddress] = useState('')
  const [legacySerial, setLegacySerial] = useState('')
  const [legacyIp, setLegacyIp] = useState('')
  const [companionSerial, setCompanionSerial] = useState('')
  const [companionIp, setCompanionIp] = useState('')
  const [pairedSerial, setPairedSerial] = useState('')
  const [updatedIp, setUpdatedIp] = useState('')
  const isRunning = Boolean(batch && !batch.finishedAt)
  const visible = fleet.devices.filter((device) => {
    if (filter === 'connected' && !fleet.connectedSerials.includes(device.serial)) return false
    if (filter === 'usb' && !device.usb) return false
    if (filter === 'wireless' && device.usb) return false
    return `${device.model ?? ''} ${device.serial}`.toLowerCase().includes(query.toLowerCase().trim())
  }).sort((a, b) => Number(fleet.connectedSerials.includes(b.serial)) - Number(fleet.connectedSerials.includes(a.serial)))

  return <main className="page-content devices-page">
    <div className="page-heading"><div><h2>设备管理</h2><p>连接设备，并勾选本次任务的运行目标。</p></div><button onClick={() => void fleet.refresh()}>↻ 刷新设备</button></div>
    <div className="device-layout">
      <section className="page-card device-list-card">
        <div className="list-toolbar">
          <input aria-label="搜索设备" placeholder="搜索型号或序列号" value={query} onChange={(event) => setQuery(event.target.value)} />
          <select aria-label="筛选设备" value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}><option value="all">全部设备</option><option value="connected">已连接</option><option value="usb">USB</option><option value="wireless">无线</option></select>
          <span>{fleet.targets.length} 台运行目标</span>
          <button onClick={() => fleet.selectTargets(fleet.connectedSerials)} disabled={isRunning || !fleet.connectedSerials.length}>全选已连接</button>
          <button onClick={() => fleet.selectTargets([])} disabled={isRunning || !fleet.targets.length}>清空</button>
        </div>
        <div className="device-table-wrap"><table className="device-table"><thead><tr><th>目标</th><th>设备</th><th>方式</th><th>设备状态</th><th>会话</th><th>任务</th><th>操作</th></tr></thead><tbody>
          {visible.map((device) => <DeviceRow key={device.serial} device={device} fleet={fleet} batch={batch} isRunning={isRunning} onFocus={onFocus} />)}
          {!visible.length && <tr><td colSpan={7} className="table-empty">没有符合条件的设备。请检查连接或刷新列表。</td></tr>}
        </tbody></table></div>
      </section>
      <aside className="page-card wireless-card">
        <h3>手机端直连</h3><p>适用于拔线后关闭 ADB 端口的手机。首次用 USB 安装并配对；之后任务和投屏走手机应用的 39828 端口。</p>
        <div className="wireless-section"><h4>1. 安装与授权</h4><label>USB 设备<select value={companionSerial} onChange={(event) => setCompanionSerial(event.target.value)}><option value="">选择设备</option>{fleet.devices.filter((device) => device.usb && device.state === 'device').map((device) => <option key={device.serial} value={device.serial}>{device.model || 'Android 设备'} · {device.serial}</option>)}</select></label><button disabled={!companionSerial || Boolean(fleet.busySerial)} onClick={() => void fleet.installCompanion(companionSerial)}>安装并打开手机端</button><p>在手机应用中依次开启无障碍、启动无线服务、允许录屏。录屏会显示系统授权弹窗。</p></div>
        <div className="wireless-section"><h4>2. 通过 USB 配对</h4><label>手机当前 Wi‑Fi IP<input placeholder="192.168.1.10" value={companionIp} onChange={(event) => setCompanionIp(event.target.value)} /></label><button className="primary" disabled={!companionSerial || !companionIp || Boolean(fleet.busySerial)} onClick={() => void fleet.pairCompanion(companionSerial, companionIp)}>配对手机端</button><p>配对成功后可拔线，在设备列表中点击“连接”。手机 IP 改变时可在下方更新地址。</p></div>
        <div className="wireless-section"><h4>已配对手机地址</h4><label>手机<select value={pairedSerial} onChange={(event) => { setPairedSerial(event.target.value); setUpdatedIp(fleet.devices.find((device) => device.serial === event.target.value)?.ip ?? '') }}><option value="">选择已配对手机</option>{fleet.devices.filter((device) => device.transport === 'companion').map((device) => <option key={device.serial} value={device.serial}>{device.model} · {device.ip}</option>)}</select></label><label>当前 Wi‑Fi IP<input placeholder="192.168.1.10" value={updatedIp} onChange={(event) => setUpdatedIp(event.target.value)} /></label><button disabled={!pairedSerial || !updatedIp || Boolean(fleet.busySerial)} onClick={() => void fleet.updateCompanionIp(pairedSerial, updatedIp)}>更新地址</button></div>
        <h3>无线 ADB</h3><p>手机与电脑需处于可互通的可信局域网。选择与手机系统兼容的方式。</p>
        <div className="wireless-section"><h4>Android 10 及以下：ADB USB 转无线</h4><p>先通过 USB 启用无线 ADB，再拔线验证；这台华为手机拔线后会关闭 5555 端口，请使用上方“手机端直连”。Android 9 及以下目前只能建立 ADB 连接，辅助 APK 尚不支持运行任务。</p><label>已授权的 USB 设备<select value={legacySerial} onChange={(event) => setLegacySerial(event.target.value)}><option value="">选择设备</option>{fleet.devices.filter((device) => device.usb && device.state === 'device').map((device) => <option key={device.serial} value={device.serial}>{device.model || 'Android 设备'} · {device.serial}</option>)}</select></label><label>手机局域网 IP<input placeholder="192.168.1.10" value={legacyIp} onChange={(event) => setLegacyIp(event.target.value)} /></label><button className="primary" disabled={isRunning || fleet.wirelessBusy || !legacySerial || !legacyIp} onClick={() => void fleet.enableLegacyWireless(legacySerial, legacyIp)}>1. 启用无线 ADB</button>{fleet.pendingLegacy && <><p>已启用 {fleet.pendingLegacy.endpoint}。请拔掉 USB 数据线，再验证无线连接。</p><button className="primary" disabled={isRunning || fleet.wirelessBusy} onClick={() => void fleet.verifyLegacyWireless()}>2. 拔线后验证连接</button>{fleet.errors[fleet.pendingLegacy.endpoint] && <p className="inline-error">{fleet.errors[fleet.pendingLegacy.endpoint]}</p>}</>}</div>
        <div className="wireless-section"><h4>Android 11+：配对设备</h4><label>配对地址和端口<input placeholder="192.168.1.10:37123" value={pairAddress} onChange={(event) => setPairAddress(event.target.value)} /></label><label>六位配对码<input inputMode="numeric" type="password" autoComplete="off" maxLength={6} value={pairCode} onChange={(event) => setPairCode(event.target.value)} /></label><button disabled={fleet.wirelessBusy || !pairAddress || !pairCode} onClick={() => { void fleet.pairWireless(pairAddress, pairCode).then((ok) => { if (ok) setPairCode('') }) }}>配对</button></div>
        <div className="wireless-section"><h4>连接已配对设备</h4><p>使用无线调试主页面显示的连接端口，通常与配对端口不同。</p><label>连接地址和端口<input placeholder="192.168.1.10:38901" value={connectAddress} onChange={(event) => setConnectAddress(event.target.value)} /></label><button className="primary" disabled={fleet.wirelessBusy || !connectAddress} onClick={() => void fleet.connectWireless(connectAddress)}>连接无线设备</button></div>
        {fleet.errors[connectAddress.trim()] && <p className="inline-error">{fleet.errors[connectAddress.trim()]}</p>}
      </aside>
    </div>
  </main>
}

/** 单行集中显示连接与运行状态，避免不同设备的失败提示混在一起。 */
function DeviceRow({ device, fleet, batch, isRunning, onFocus }: { device: Device; fleet: Fleet; batch: BatchRecord | null; isRunning: boolean; onFocus: (serial: string) => void }) {
  const connected = fleet.connectedSerials.includes(device.serial)
  const run = batch?.devices.find((item) => item.serial === device.serial)
  const taskStatus = isRunning && run ? run.status : '空闲'
  return <tr>
    <td><input type="checkbox" aria-label={`选择 ${device.serial} 为运行目标`} checked={fleet.targets.includes(device.serial)} disabled={!connected || isRunning} onChange={() => fleet.toggleTarget(device.serial)} /></td>
    <td><strong>{device.model || 'Android 设备'}</strong><small>{device.serial}{device.ip ? ` · ${device.ip}` : ''}</small>{fleet.errors[device.serial] && <small className="inline-error">{fleet.errors[device.serial]}</small>}</td>
    <td>{device.transport === 'companion' ? '手机端直连' : device.usb ? 'USB' : '无线 ADB'}</td><td><span className={`state-pill ${device.state === 'device' || device.state === 'paired' ? 'ok' : 'warn'}`}>{deviceState(device.state)}</span></td>
    <td><span className={`state-pill ${connected ? 'ok' : ''}`}>{connected ? '已连接' : '未连接'}</span></td>
    <td>{runStatus(taskStatus)}</td>
    <td><div className="row-actions">{connected
      ? <button onClick={() => void fleet.disconnect(device.serial)} disabled={fleet.busySerial === device.serial || Boolean(isRunning && run && (run.status === 'pending' || run.status === 'running'))}>断开</button>
      : device.state === 'device' || device.transport === 'companion'
        ? <button onClick={() => void fleet.connect(device.serial)} disabled={fleet.busySerial === device.serial}>连接</button>
        // 无线设备离线只需重新 adb connect（serial 即端点）；USB 离线插线即恢复，无需按钮。
        : !device.usb && <button onClick={() => void fleet.reconnectWireless(device.serial)} disabled={fleet.wirelessBusy}>重连</button>}{connected && <button onClick={() => onFocus(device.serial)} disabled={isRunning}>设为编辑设备</button>}</div></td>
  </tr>
}

function deviceState(state: string): string {
  if (state === 'device') return '已授权'
  if (state === 'paired') return '已配对'
  if (state === 'unauthorized') return '等待手机授权'
  if (state === 'offline') return '离线'
  return state
}

function runStatus(status: string): string {
  return { pending: '待运行', running: '运行中', success: '成功', failure: '失败', cancelled: '已取消' }[status] ?? status
}
