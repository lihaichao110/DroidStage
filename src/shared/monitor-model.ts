/**
 * 运行工作台的设备筛选、排序与状态统计，供界面和测试共用。
 */
import type { BatchSummary, Device, DeviceRunStatus } from './types'

export type MonitorStatus = DeviceRunStatus | 'idle'
export type MonitorFilter = MonitorStatus | 'all'
export type MonitorRow = {
  serial: string
  model: string
  status: MonitorStatus
  stepIndex?: number
  error?: string
  connected: boolean
}

const ORDER: Record<MonitorStatus, number> = {
  failure: 0, partial: 1, running: 2, pending: 3,
  cancelled: 4, success: 5, idle: 6
}

export const STATUS_LABELS: Record<MonitorStatus, string> = {
  pending: '待运行', running: '运行中', success: '成功', partial: '部分完成',
  failure: '失败', cancelled: '已取消', idle: '空闲'
}

/**
 * 生成监看列表；当前批次模式保留掉线目标，全部设备模式仅列出已连接设备。
 * @param batch 所选批次；无批次时显示空闲设备
 * @param devices 发现的设备信息
 * @param connectedSerials 当前可用会话
 * @param scope 当前批次或全部已连接
 * @param filter 状态筛选
 * @param query 型号或序列号搜索词
 * @returns 异常优先且序列号稳定排序的设备行
 */
export function monitorRows(batch: BatchSummary | null, devices: Device[], connectedSerials: string[], scope: 'batch' | 'all', filter: MonitorFilter, query: string): MonitorRow[] {
  const connected = new Set(connectedSerials)
  const bySerial = new Map(devices.map((device) => [device.serial, device]))
  const runs = new Map(batch?.devices.map((run) => [run.serial, run]) ?? [])
  const serials = scope === 'batch' && batch ? batch.devices.map((run) => run.serial) : connectedSerials
  const search = query.trim().toLocaleLowerCase()
  return serials.map((serial): MonitorRow => {
    const run = runs.get(serial)
    return {
      serial, model: bySerial.get(serial)?.model || 'Android 设备',
      status: run?.status ?? 'idle', stepIndex: run?.stepIndex,
      error: run?.error, connected: connected.has(serial)
    }
  }).filter((row) => (filter === 'all' || row.status === filter) &&
    (!search || `${row.model} ${row.serial}`.toLocaleLowerCase().includes(search)))
    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.serial.localeCompare(b.serial))
}

/** 当前批次状态统计；不把未参与任务的已连接设备算入批次。 */
export function monitorCounts(batch: BatchSummary | null): Record<DeviceRunStatus, number> {
  const counts = { pending: 0, running: 0, success: 0, partial: 0, failure: 0, cancelled: 0 }
  for (const device of batch?.devices ?? []) counts[device.status] += 1
  return counts
}

/** 首次进入批次时优先查看正在执行的设备。 */
export function preferredMonitorSerial(batch: BatchSummary | null): string {
  return batch?.devices.find((device) => device.status === 'running')?.serial ?? batch?.devices[0]?.serial ?? ''
}

/** 确认运行时选定的首要监看设备：焦点设备在目标内则用之，否则第一台目标。 */
export function primaryRunSerial(targets: string[], focused: string | null): string {
  if (!targets.length) return ''
  return focused && targets.includes(focused) ? focused : targets[0]
}

/** 准备期的画面列表：首要设备置顶、其余目标依次补足，最多 4 路（与工作台同屏上限一致）。 */
export function pendingPreviewSerials(targets: string[], primary: string): string[] {
  return [primary, ...targets.filter((serial) => serial !== primary)].filter(Boolean).slice(0, 4)
}
