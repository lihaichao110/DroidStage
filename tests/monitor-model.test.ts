/**
 * 运行工作台列表测试：三十台设备的状态统计、异常优先排序与搜索筛选。
 */
import { describe, expect, it } from 'vitest'
import { monitorCounts, monitorRows, pendingPreviewSerials, preferredMonitorSerial, primaryRunSerial } from '../src/shared/monitor-model'
import type { BatchSummary, Device, DeviceRunStatus } from '../src/shared/types'

const statuses: DeviceRunStatus[] = ['success', 'pending', 'running', 'partial', 'failure', 'cancelled']
const devices: Device[] = Array.from({ length: 30 }, (_, index) => ({ serial: `serial-${String(index).padStart(2, '0')}`, model: `型号 ${index}`, state: 'device', usb: true }))
const batch: BatchSummary = {
  id: 'batch-30', taskName: '批量任务', startedAt: '2026-01-01T00:00:00Z',
  devices: devices.map((device, index) => ({ serial: device.serial, status: statuses[index % statuses.length], stepIndex: index }))
}

describe('运行工作台设备模型', () => {
  it('三十台设备按异常优先排序且各状态数量准确', () => {
    const rows = monitorRows(batch, devices, devices.map((device) => device.serial), 'batch', 'all', '')
    expect(rows).toHaveLength(30)
    expect(rows.slice(0, 5).every((row) => row.status === 'failure')).toBe(true)
    expect(rows.at(-1)?.status).toBe('success')
    expect(monitorCounts(batch)).toEqual({ pending: 5, running: 5, success: 5, partial: 5, failure: 5, cancelled: 5 })
    expect(preferredMonitorSerial(batch)).toBe('serial-02')
  })

  it('搜索和筛选保留掉线批次目标，全部已连接范围只显示在线设备', () => {
    const connected = devices.slice(1).map((device) => device.serial)
    expect(monitorRows(batch, devices, connected, 'batch', 'success', 'serial-00')).toMatchObject([
      { serial: 'serial-00', status: 'success', connected: false }
    ])
    expect(monitorRows(batch, devices, connected, 'all', 'all', '')).toHaveLength(29)
    expect(monitorRows(batch, devices, connected, 'batch', 'failure', '型号 4')).toMatchObject([
      { serial: 'serial-04', status: 'failure' }
    ])
  })
})

describe('运行准备期的首要设备与画面列表', () => {
  it('焦点设备在目标内则作为首要设备，否则回退第一台目标', () => {
    expect(primaryRunSerial(['serial-a', 'serial-b'], 'serial-b')).toBe('serial-b')
    expect(primaryRunSerial(['serial-a', 'serial-b'], 'serial-x')).toBe('serial-a')
    expect(primaryRunSerial(['serial-a', 'serial-b'], null)).toBe('serial-a')
    expect(primaryRunSerial([], 'serial-a')).toBe('')
  })

  it('准备期画面首要设备置顶且最多 4 路', () => {
    expect(pendingPreviewSerials(['serial-a', 'serial-b', 'serial-c'], 'serial-b')).toEqual(['serial-b', 'serial-a', 'serial-c'])
    expect(pendingPreviewSerials(['serial-a', 'serial-b', 'serial-c', 'serial-d', 'serial-e'], 'serial-a')).toEqual(['serial-a', 'serial-b', 'serial-c', 'serial-d'])
    expect(pendingPreviewSerials(['serial-a'], 'serial-a')).toEqual(['serial-a'])
  })
})
