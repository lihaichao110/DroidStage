/**
 * 无线 ADB 引导：配对与连接分离，已配对设备可直接连接。
 */
import { useState } from 'react'
import type { DeviceFleet } from '../utils/device-manager-types'
import { ConnectionButton, ConnectionStep } from './device-connection-fields'
import { UiIcon } from './ui-icon'

/**
 * 仅在真实配对成功后清除配对码，连接状态仍以设备会话为准。
 * @param props 会话数据及旧版无线连接入口
 * @returns 分离首次配对与直接连接的表单
 */
export function DeviceWirelessForm({ fleet, onLegacy }: { fleet: DeviceFleet; onLegacy: () => void }) {
  const [pairAddress, setPairAddress] = useState('')
  const [pairCode, setPairCode] = useState('')
  const [connectAddress, setConnectAddress] = useState('')
  const busy = fleet.wirelessBusy || Boolean(fleet.busySerial)
  return <>
    <div className="connection-notice"><UiIcon name="info" size={16} />Android 11 及以上 · 手机与电脑需在同一局域网</div>
    <ConnectionStep number={1} title="首次配对"><p>手机开启无线调试，选择「使用配对码配对」。</p>
      <label className="connection-field">配对地址和端口<input placeholder="192.168.1.10:37123" value={pairAddress} onChange={(event) => setPairAddress(event.target.value)} /></label>
      <label className="connection-field">六位配对码<input inputMode="numeric" type="password" autoComplete="off" maxLength={6} placeholder="输入配对码" value={pairCode} onChange={(event) => setPairCode(event.target.value)} /></label>
      <ConnectionButton disabled={busy || !pairAddress.trim() || !/^\d{6}$/.test(pairCode)} onAction={async () => { if (await fleet.pairWireless(pairAddress, pairCode)) setPairCode('') }}>配对设备</ConnectionButton>
    </ConnectionStep>
    <ConnectionStep number={2} title="连接设备"><p className="connection-skip">已配对？可直接进行此步</p>
      <label className="connection-field">连接地址和端口<input placeholder="192.168.1.10:38901" value={connectAddress} onChange={(event) => setConnectAddress(event.target.value)} /></label>
      <div className="connection-warning"><UiIcon name="info" size={16} />连接端口与配对端口不同，请查看无线调试主页面。</div>
      <ConnectionButton primary disabled={busy || !connectAddress.trim()} onAction={() => fleet.connectWireless(connectAddress)}><UiIcon name="link" size={17} />连接无线设备</ConnectionButton>
      {fleet.errors[connectAddress.trim()] && <p className="device-error" role="alert">{fleet.errors[connectAddress.trim()]}</p>}
    </ConnectionStep>
    <button className="connection-link" onClick={onLegacy}>旧版 Android？使用 USB 转无线</button>
  </>
}
