/**
 * 设备行：分开展示授权与连接状态，保留运行中的会话保护。
 */
import { useRef, useState } from 'react'
import type { BatchSummary, Device } from '../../../shared/types'
import { canDisconnect, deviceAction, deviceStatus } from '../../../shared/device-manager-model'
import { STATUS_LABELS } from '../../../shared/monitor-model'
import type { DeviceFleet } from '../utils/device-manager-types'
import { DeviceRowMenu } from './device-row-menu'
import { UiIcon } from './ui-icon'

type Props = {
  device: Device; fleet: DeviceFleet; batch: BatchSummary | null; isRunning: boolean
  onFocus: (serial: string) => void; onEditAddress: (serial: string) => void
}

/**
 * 主操作保持可见，低频操作使用菜单，避免挤占设备信息宽度。
 * @param props 当前设备、会话状态与设备操作回调
 * @returns 设备状态和可用操作组成的一行
 */
export function DeviceTableRow({ device, fleet, batch, isRunning, onFocus, onEditAddress }: Props) {
  const [isSubmitting, setSubmitting] = useState(false)
  const submitLock = useRef(false)
  const connected = fleet.connectedSerials.includes(device.serial)
  const selected = fleet.targets.includes(device.serial)
  const focused = fleet.focused === device.serial
  const run = batch?.devices.find((item) => item.serial === device.serial)
  const action = deviceAction(device, connected)
  const busy = isSubmitting || Boolean(fleet.busySerial) || fleet.wirelessBusy
  const isThisBusy = isSubmitting || fleet.busySerial === device.serial
  const disabled = busy || (action === 'disconnect' && !canDisconnect(isRunning, run?.status)) || action === 'authorize' || action === 'offline'
  const label = { connect: '连接', disconnect: '断开', reconnect: '重连', authorize: '等待授权', offline: '检查 USB' }[action]

  /** 同步锁覆盖连续点击，会话忙碌状态阻止跨设备并发操作。 */
  async function submit(): Promise<void> {
    if (submitLock.current || disabled) return
    submitLock.current = true
    setSubmitting(true)
    try {
      if (action === 'connect') await fleet.connect(device.serial)
      else if (action === 'disconnect') await fleet.disconnect(device.serial)
      else if (action === 'reconnect') await fleet.reconnectWireless(device.serial)
    } finally { submitLock.current = false; setSubmitting(false) }
  }

  return <tr className={selected ? 'is-target' : undefined}>
    <td><input type="checkbox" aria-label={`选择 ${device.serial} 为运行目标`} checked={selected} disabled={!connected || isRunning} onChange={() => fleet.toggleTarget(device.serial)} /></td>
    <td><div className="device-identity"><UiIcon name="phone" size={20} /><div><div className="device-name"><strong>{device.model || 'Android 设备'}</strong>{focused && <span className="device-focus-tag">编辑设备</span>}</div><small>{device.serial}{device.ip ? ` / ${device.ip}` : ''}</small>{fleet.errors[device.serial] && <small className="device-error" role="alert">{fleet.errors[device.serial]}</small>}</div></div></td>
    <td>{device.transport === 'companion' ? '手机端直连' : device.usb ? 'USB' : '无线 ADB'}</td>
    <td><span className={`device-pill ${device.state === 'device' || device.state === 'paired' ? 'ok' : 'warn'}`}>{deviceStatus(device.state)}</span></td>
    <td><span className={`device-pill${connected ? ' ok' : ''}`}>{connected && <UiIcon name="check" size={13} />}{connected ? '已连接' : '未连接'}</span></td>
    <td>{isRunning && run ? STATUS_LABELS[run.status] : '空闲'}</td>
    <td><div className="device-row-actions"><button disabled={disabled} aria-busy={isThisBusy} onClick={() => void submit()} title={action === 'authorize' ? '请在手机上允许 USB 调试' : action === 'offline' ? '请检查数据线并刷新设备' : undefined}><UiIcon name={action === 'reconnect' ? 'refresh' : action === 'disconnect' ? 'unlink' : 'link'} size={16} />{isThisBusy ? '处理中…' : label}</button>
      <DeviceRowMenu device={device} canFocus={connected && !isRunning && !busy && !focused} onFocus={() => onFocus(device.serial)} onEditAddress={() => onEditAddress(device.serial)} />
    </div></td>
  </tr>
}
