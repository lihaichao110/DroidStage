/**
 * 设备管理视图模型：集中处理筛选、状态文案和设备操作可用性。
 */
import type { Device, DeviceRunStatus } from './types'

export type DeviceFilter = 'all' | 'connected' | 'usb' | 'wireless'
export type DeviceAction = 'connect' | 'disconnect' | 'reconnect' | 'authorize' | 'offline'

/**
 * 筛选设备并保持已连接设备优先，不改变发现列表。
 * @param devices 发现的设备
 * @param connectedSerials 已建立会话的设备序列号
 * @param filter 连接方式或会话筛选
 * @param query 型号、序列号或 IP 搜索词
 * @returns 新的设备数组
 */
export function filterDevices(devices: Device[], connectedSerials: string[], filter: DeviceFilter, query: string): Device[] {
  const connected = new Set(connectedSerials)
  const search = query.trim().toLowerCase()
  return devices.filter((device) => {
    if (filter === 'connected' && !connected.has(device.serial)) return false
    if (filter === 'usb' && !device.usb) return false
    if (filter === 'wireless' && device.usb) return false
    return `${device.model ?? ''} ${device.serial} ${device.ip ?? ''}`.toLowerCase().includes(search)
  }).sort((a, b) => Number(connected.has(b.serial)) - Number(connected.has(a.serial)))
}

/**
 * 将授权或配对状态转换为中文，不把它当作会话连接状态。
 * @param state 设备发现状态
 * @returns 中文状态，未知状态保留原值供排查
 */
export function deviceStatus(state: string): string {
  return { device: '已授权', paired: '已配对', unauthorized: '等待手机授权', offline: '离线' }[state] ?? state
}

/**
 * 直连设备即使没有 ADB 会话，也仍需允许使用手机端协议连接。
 * @param device 设备的发现信息与传输方式
 * @param connected 是否已建立任务会话
 * @returns 设备行应提供的主操作
 */
export function deviceAction(device: Device, connected: boolean): DeviceAction {
  if (connected) return 'disconnect'
  if (device.state === 'device' || device.transport === 'companion') return 'connect'
  if (!device.usb) return 'reconnect'
  return device.state === 'unauthorized' ? 'authorize' : 'offline'
}

/**
 * 已排队或正在执行任务的会话不能断开，避免中途破坏批次。
 * @param isRunning 当前是否有未结束批次
 * @param status 此设备在批次中的状态
 * @returns 是否允许断开设备会话
 */
export function canDisconnect(isRunning: boolean, status?: DeviceRunStatus): boolean {
  return !isRunning || (status !== 'pending' && status !== 'running')
}
