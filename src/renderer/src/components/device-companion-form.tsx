/**
 * 手机端直连：首次安装配对及已配对手机地址维护。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { AddressRequest, DeviceFleet } from '../utils/device-manager-types'
import { ConnectionButton, ConnectionStep, UsbDeviceField } from './device-connection-fields'
import { UiIcon } from './ui-icon'

/**
 * 地址编辑请求来自设备行，展开区域后直接定位到对应手机的 IP 输入。
 * @param props 会话数据、地址编辑请求和当前可见性
 * @returns 手机端安装、配对和地址维护表单
 */
export function DeviceCompanionForm({ fleet, addressRequest, isActive }: { fleet: DeviceFleet; addressRequest: AddressRequest | null; isActive: boolean }) {
  const [serial, setSerial] = useState('')
  const [ip, setIp] = useState('')
  const [pairedSerial, setPairedSerial] = useState('')
  const [updatedIp, setUpdatedIp] = useState('')
  const [isAddressOpen, setAddressOpen] = useState(false)
  const addressField = useRef<HTMLInputElement>(null)
  const pairedDevices = fleet.devices.filter((device) => device.transport === 'companion')
  const pairedDevice = pairedDevices.find((device) => device.serial === pairedSerial)
  const isAuthorized = fleet.devices.some((device) => device.serial === serial && device.usb && device.state === 'device')
  const busy = Boolean(fleet.busySerial) || fleet.wirelessBusy
  // 后台刷新不应覆盖用户正在修改的 IP；只在收到新的编辑请求时读取设备地址。
  const devicesRef = useRef(fleet.devices)
  devicesRef.current = fleet.devices
  useEffect(() => {
    if (!addressRequest) return
    setPairedSerial(addressRequest.serial)
    setUpdatedIp(devicesRef.current.find((device) => device.serial === addressRequest.serial)?.ip ?? '')
    setAddressOpen(true)
  }, [addressRequest])
  // 等标签和折叠区域都可见后再聚焦；后台窗口不一定会触发动画帧。
  useLayoutEffect(() => {
    if (!addressRequest || !isActive || !isAddressOpen) return
    addressField.current?.scrollIntoView({ block: 'nearest' })
    addressField.current?.focus({ preventScroll: true })
  }, [addressRequest, isActive, isAddressOpen])

  return <>
    <div className="connection-notice"><UiIcon name="info" size={16} />首次通过 USB 安装配对，之后可拔线直连</div>
    <ConnectionStep number={1} title="选择 USB 设备"><UsbDeviceField fleet={fleet} value={serial} onChange={setSerial} /></ConnectionStep>
    <ConnectionStep number={2} title="安装与授权"><ConnectionButton disabled={!isAuthorized || busy} onAction={() => fleet.installCompanion(serial)}>安装并打开手机端</ConnectionButton><p>在手机应用中开启无障碍、启动无线服务并允许录屏。录屏需在手机系统弹窗中授权。</p></ConnectionStep>
    <ConnectionStep number={3} title="配对手机端"><label className="connection-field">手机 Wi-Fi IP<input placeholder="192.168.1.10" value={ip} onChange={(event) => setIp(event.target.value)} /></label><ConnectionButton primary disabled={!isAuthorized || !ip.trim() || busy} onAction={() => fleet.pairCompanion(serial, ip)}>配对手机端</ConnectionButton><p>配对成功后可拔线，在左侧设备列表中点击「连接」。</p></ConnectionStep>
    <details className="connection-disclosure" open={isAddressOpen} onToggle={(event) => setAddressOpen(event.currentTarget.open)}>
      <summary>更新已配对设备地址</summary>
      <div className="connection-disclosure-body"><label className="connection-field">已配对手机<select value={pairedDevice ? pairedSerial : ''} onChange={(event) => { setPairedSerial(event.target.value); setUpdatedIp(pairedDevices.find((device) => device.serial === event.target.value)?.ip ?? '') }}><option value="">选择已配对手机</option>{pairedDevices.map((device) => <option key={device.serial} value={device.serial}>{device.model || 'Android 设备'} · {device.ip || device.serial}</option>)}</select></label>
        <label className="connection-field">当前 Wi-Fi IP<input ref={addressField} placeholder="192.168.1.10" value={updatedIp} onChange={(event) => setUpdatedIp(event.target.value)} /></label>
        <ConnectionButton disabled={!pairedDevice || !updatedIp.trim() || busy} onAction={() => fleet.updateCompanionIp(pairedSerial, updatedIp)}>更新地址</ConnectionButton><p>手机 IP 改变时更新地址，再从列表重新连接。</p>
      </div>
    </details>
  </>
}
