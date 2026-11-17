/**
 * 连接面板：三种连接方式按需展示，隐藏时保留各自的表单输入。
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { AddressRequest, ConnectionMode, DeviceFleet } from '../utils/device-manager-types'
import connectionRobot from '../assets/device-connection-robot.png'
import { DeviceUsbForm } from './device-usb-form'
import { DeviceWirelessForm } from './device-wireless-form'
import { DeviceCompanionForm } from './device-companion-form'
import { UiIcon } from './ui-icon'

const MODES: { id: ConnectionMode; label: string }[] = [{ id: 'usb', label: 'USB 连接' }, { id: 'wireless', label: '无线 ADB' }, { id: 'companion', label: '手机端直连' }]
const HELP: Record<ConnectionMode, string> = {
  usb: '请保持手机解锁，检查数据线是否支持传输、USB 调试是否开启以及手机是否确认授权。若提示缺少 ADB 或驱动，请查看底部完整错误信息。',
  wireless: '请确认电脑可访问手机所在局域网，使用当前配对码与配对端口。连接时请使用无线调试主页面的连接端口；手机重启或网络变化后可能需要重新连接。',
  companion: '请检查手机端无障碍权限、无线服务和录屏授权，确认手机与电脑网络互通。IP 变化后展开下方地址维护区域更新，并重新连接。'
}
type Props = { fleet: DeviceFleet; isRunning: boolean; isOpen: boolean; isRefreshing: boolean; onRefresh: () => void; onCollapse: () => void; addressRequest: AddressRequest | null }

/**
 * 使用隐藏而非卸载，避免切换连接方式丢失用户输入。
 * @param props 会话状态、面板可见性、刷新回调和地址编辑请求
 * @returns 可收起的三种连接方式引导
 */
export function DeviceConnectionPanel({ fleet, isRunning, isOpen, isRefreshing, onRefresh, onCollapse, addressRequest }: Props) {
  const [mode, setMode] = useState<ConnectionMode>('usb')
  const [isLegacyOpen, setLegacyOpen] = useState(false)
  const tabList = useRef<HTMLDivElement>(null)
  useEffect(() => { if (addressRequest) setMode('companion') }, [addressRequest])

  /** 标签支持方向键，选择与键盘焦点保持同步。 */
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? MODES.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + MODES.length) % MODES.length
    setMode(MODES[next].id)
    tabList.current?.querySelectorAll<HTMLButtonElement>('[role=tab]')[next]?.focus()
  }

  return <aside id="device-connection-panel" className="devices-card device-connection-panel" hidden={!isOpen} aria-label="连接设备">
    <div className="connection-head"><h2><UiIcon name="plug" size={25} />连接设备</h2><img src={connectionRobot} alt="" aria-hidden="true" /><button className="connection-collapse" onClick={onCollapse}>收起 »</button></div>
    <div className="connection-tabs" role="tablist" aria-label="连接方式" ref={tabList}>{MODES.map((item, index) => <button key={item.id} id={`connection-tab-${item.id}`} role="tab" aria-selected={mode === item.id} aria-controls={`connection-form-${item.id}`} tabIndex={mode === item.id ? 0 : -1} onClick={() => setMode(item.id)} onKeyDown={(event) => navigate(event, index)}>{item.label}</button>)}</div>
    <div className="connection-scroll">
      <div role="tabpanel" id="connection-form-usb" aria-labelledby="connection-tab-usb" hidden={mode !== 'usb'}><DeviceUsbForm fleet={fleet} isRunning={isRunning} isLegacyOpen={isLegacyOpen} onLegacyToggle={setLegacyOpen} isRefreshing={isRefreshing} onRefresh={onRefresh} /></div>
      <div role="tabpanel" id="connection-form-wireless" aria-labelledby="connection-tab-wireless" hidden={mode !== 'wireless'}><DeviceWirelessForm fleet={fleet} onLegacy={() => { setMode('usb'); setLegacyOpen(true) }} /></div>
      <div role="tabpanel" id="connection-form-companion" aria-labelledby="connection-tab-companion" hidden={mode !== 'companion'}><DeviceCompanionForm fleet={fleet} addressRequest={addressRequest} isActive={mode === 'companion' && isOpen} /></div>
      <details className="connection-help" key={mode}><summary>连接遇到问题？</summary><p>{HELP[mode]}</p></details>
    </div>
  </aside>
}
