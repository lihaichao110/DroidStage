/**
 * 设备视图测试：验证筛选不改变源数据，并保护连接动作与任务会话。
 */
import { describe, expect, it } from 'vitest'
import type { Device } from '../src/shared/types'
import { canDisconnect, deviceAction, deviceStatus, filterDevices } from '../src/shared/device-manager-model'

const devices: Device[] = [
  { serial: 'usb-offline', model: 'Pixel', usb: true, state: 'offline' },
  { serial: 'direct:phone', model: 'HUAWEI', usb: false, transport: 'companion', state: 'paired', ip: '192.168.1.25' },
  { serial: 'USB-123', model: 'Xiaomi', usb: true, state: 'device' },
  { serial: '192.168.1.30:1234', usb: false, state: 'offline' },
  { serial: 'USB-auth', usb: true, state: 'unauthorized' }
]

describe('设备管理视图', () => {
  it('支持型号、序列号和直连 IP，忽略大小写及首尾空格', () => {
    expect(filterDevices(devices, [], 'all', ' hUaWeI ')).toEqual([devices[1]])
    expect(filterDevices(devices, [], 'all', 'usb-123')).toEqual([devices[2]])
    expect(filterDevices(devices, [], 'all', '192.168.1.25')).toEqual([devices[1]])
    expect(filterDevices(devices, [], 'all', '192.168.1.30')).toEqual([devices[3]])
  })
  it('已连接优先且同组稳定，不修改发现顺序', () => {
    const original = [...devices]
    expect(filterDevices(devices, ['USB-123', 'direct:phone'], 'all', '').map((item) => item.serial)).toEqual(['direct:phone', 'USB-123', 'usb-offline', '192.168.1.30:1234', 'USB-auth'])
    expect(devices).toEqual(original)
  })
  it('连接筛选以真实会话为准，配对不等于已连接', () => {
    expect(filterDevices(devices, ['USB-123'], 'connected', '')).toEqual([devices[2]])
    expect(filterDevices(devices, [], 'usb', '')).toEqual([devices[0], devices[2], devices[4]])
    expect(filterDevices(devices, [], 'wireless', '')).toEqual([devices[1], devices[3]])
    expect(filterDevices(devices, ['USB-123'], 'connected', 'HUAWEI')).toEqual([])
    expect(filterDevices([], [], 'all', '')).toEqual([])
  })
  it('按传输方式提供连接、重连或等待授权，不为 USB 离线提供无线重连', () => {
    expect(deviceAction(devices[0], false)).toBe('offline')
    expect(deviceAction(devices[1], false)).toBe('connect')
    expect(deviceAction(devices[2], false)).toBe('connect')
    expect(deviceAction(devices[3], false)).toBe('reconnect')
    expect(deviceAction(devices[4], false)).toBe('authorize')
    expect(deviceAction(devices[1], true)).toBe('disconnect')
  })
  it('任务排队与运行期间禁止断开；其他设备仍可管理', () => {
    expect(canDisconnect(true, 'pending')).toBe(false)
    expect(canDisconnect(true, 'running')).toBe(false)
    expect(canDisconnect(true, 'success')).toBe(true)
    expect(canDisconnect(true)).toBe(true)
    expect(canDisconnect(false, 'running')).toBe(true)
  })
  it('状态文案区分授权和配对，保留未知状态供排查', () => {
    expect(deviceStatus('device')).toBe('已授权')
    expect(deviceStatus('paired')).toBe('已配对')
    expect(deviceStatus('unauthorized')).toBe('等待手机授权')
    expect(deviceStatus('offline')).toBe('离线')
    expect(deviceStatus('unknown')).toBe('unknown')
  })
})
