/**
 * 连接引导共用控件：编号步骤、已授权 USB 选择与防重复提交按钮。
 */
import { useRef, useState, type ReactNode } from 'react'
import type { DeviceFleet } from '../utils/device-manager-types'

/**
 * 步骤编号只表示操作顺序，不暗示已经完成授权或配对。
 * @param props 编号、步骤标题和内容
 * @returns 编号引导步骤
 */
export function ConnectionStep({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return <section className="connection-step"><h3><span>{number}</span>{title}</h3><div className="connection-step-body">{children}</div></section>
}

/**
 * 下拉仅列出已授权的 USB 设备；设备拔出后不能继续提交旧选择。
 * @param props 会话数据、已选序列号和选择回调
 * @returns USB 设备选择字段
 */
export function UsbDeviceField({ fleet, value, onChange }: { fleet: DeviceFleet; value: string; onChange: (value: string) => void }) {
  const available = fleet.devices.filter((device) => device.usb && device.state === 'device')
  return <label className="connection-field">USB 设备<select value={available.some((device) => device.serial === value) ? value : ''} onChange={(event) => onChange(event.target.value)}><option value="">请选择已授权设备</option>{available.map((device) => <option key={device.serial} value={device.serial}>{device.model || 'Android 设备'} · {device.serial}</option>)}</select></label>
}

/**
 * 会话更新前先锁定按钮，避免快速双击触发两次 ADB 命令。
 * @param props 按钮内容、禁用状态和已由会话层处理错误的异步操作
 * @returns 带忙碌反馈和提交锁的按钮
 */
export function ConnectionButton({ children, disabled, primary, onAction }: { children: ReactNode; disabled?: boolean; primary?: boolean; onAction: () => Promise<unknown> }) {
  const [isPending, setPending] = useState(false)
  const lock = useRef(false)
  async function submit(): Promise<void> {
    if (lock.current || disabled) return
    lock.current = true
    setPending(true)
    try { await onAction() }
    finally { lock.current = false; setPending(false) }
  }
  return <button className={primary ? 'primary connection-submit' : 'connection-submit'} disabled={disabled || isPending} aria-busy={isPending} onClick={() => void submit()}>{isPending ? '处理中…' : children}</button>
}
