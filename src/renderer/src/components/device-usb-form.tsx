/**
 * USB 连接引导：调试授权说明及旧版设备的拔线验证流程。
 */
import { useState } from 'react'
import type { DeviceFleet } from '../utils/device-manager-types'
import { ConnectionButton, ConnectionStep, UsbDeviceField } from './device-connection-fields'
import { UiIcon } from './ui-icon'

type Props = { fleet: DeviceFleet; isRunning: boolean; isLegacyOpen: boolean; onLegacyToggle: (open: boolean) => void; isRefreshing: boolean; onRefresh: () => void }

/**
 * 无线端口启用与拔线验证分开展示，避免提前宣称连接成功。
 * @param props 会话数据、批次保护、刷新与旧版无线区域状态
 * @returns USB 授权说明与可展开的转无线表单
 */
export function DeviceUsbForm({ fleet, isRunning, isLegacyOpen, onLegacyToggle, isRefreshing, onRefresh }: Props) {
  const [serial, setSerial] = useState('')
  const [ip, setIp] = useState('')
  const hasUsb = fleet.devices.some((device) => device.usb)
  const isAuthorized = fleet.devices.some((device) => device.serial === serial && device.usb && device.state === 'device')
  const busy = Boolean(fleet.busySerial) || fleet.wirelessBusy
  return <>
    <div className="connection-notice"><UiIcon name="info" size={16} />使用支持数据传输的 USB 线连接手机与电脑</div>
    <ConnectionStep number={1} title="连接手机并开启调试"><p>在手机开发者选项中开启「USB 调试」，保持手机解锁。</p></ConnectionStep>
    <ConnectionStep number={2} title="在手机上确认授权"><p>出现「允许 USB 调试」提示时点击允许。未出现弹窗时，可重新插线后刷新设备。</p>
      {fleet.devices.some((device) => device.usb && device.state === 'unauthorized') && <p className="connection-warning">有设备等待授权，请在手机上确认。</p>}
      {fleet.devices.some((device) => device.usb && device.state === 'offline') && <p className="connection-warning">有 USB 设备离线，请检查数据线、接口及调试设置。</p>}
    </ConnectionStep>
    <ConnectionStep number={3} title="刷新并连接设备"><p>{hasUsb ? '在左侧列表找到已授权设备，点击「连接」建立任务会话。' : '暂未发现 USB 设备，完成插线和授权后点击刷新。'}</p><button className="connection-submit" disabled={isRefreshing} onClick={onRefresh}><UiIcon name="refresh" size={17} />{isRefreshing ? '刷新中…' : '刷新设备列表'}</button></ConnectionStep>
    <details className="connection-disclosure" open={isLegacyOpen} onToggle={(event) => onLegacyToggle(event.currentTarget.open)}>
      <summary>USB 转无线 <span>旧版 Android</span></summary>
      <div className="connection-disclosure-body"><p>先用 USB 启用无线 ADB，再拔线验证。部分手机拔线后会关闭端口，可改用「手机端直连」。Android 9 及以下可连接 ADB，暂不支持运行任务。</p>
        <UsbDeviceField fleet={fleet} value={serial} onChange={setSerial} />
        <label className="connection-field">手机局域网 IP<input placeholder="192.168.1.10" value={ip} onChange={(event) => setIp(event.target.value)} /></label>
        <ConnectionButton primary disabled={isRunning || busy || !isAuthorized || !ip.trim()} onAction={() => fleet.enableLegacyWireless(serial, ip)}>1. 启用无线 ADB</ConnectionButton>
        {fleet.pendingLegacy && <div className="legacy-verification"><p>已启用 {fleet.pendingLegacy.endpoint}。请拔掉 USB 数据线，再验证连接。</p><ConnectionButton primary disabled={isRunning || busy} onAction={fleet.verifyLegacyWireless}>2. 拔线后验证连接</ConnectionButton>{fleet.errors[fleet.pendingLegacy.endpoint] && <p className="device-error" role="alert">{fleet.errors[fleet.pendingLegacy.endpoint]}</p>}</div>}
        {fleet.errors[serial] && <p className="device-error" role="alert">{fleet.errors[serial]}</p>}
      </div>
    </details>
  </>
}
