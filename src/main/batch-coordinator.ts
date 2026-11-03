/**
 * 批次运行编排：同一任务独立并行运行在多个设备上，并保存可恢复的批次记录。
 */
import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AutomationTask, BatchPage, BatchRecord, BatchSummary, RunEvent } from '../shared/types'
import { validateTask } from '../shared/task'
import { DeviceRegistry } from './device-registry'
import { TaskRunner } from './runner'
import { listDevices } from './adb'

export class BatchCoordinator {
  private current: BatchRecord | null = null
  private readonly runners = new Map<string, TaskRunner>()
  private readonly startingTargets = new Set<string>()
  private writeQueue: Promise<void> = Promise.resolve()
  private pendingWrite: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly devices: DeviceRegistry, private readonly emit: (event: RunEvent) => void) {}

  isRunning(serial?: string): boolean {
    return serial ? this.startingTargets.has(serial) || (this.runners.get(serial)?.isRunning() ?? false) : this.startingTargets.size > 0 || this.runners.size > 0
  }

  state(): BatchRecord | null { return this.current }

  /** 返回当前批次的轻量摘要，运行事件通过独立接口按设备读取。 */
  summary(): BatchSummary | null { return this.current ? summarize(this.current) : null }

  /** 校验全部目标后启动一个批次；设备失败只记录在该设备，不阻断其他设备。 */
  async start(task: AutomationTask, serials: string[]): Promise<BatchRecord> {
    if (this.isRunning()) throw new Error('已有任务批次在运行')
    validateTask(task)
    if (!task.steps.length) throw new Error('请先添加至少一个步骤')
    const targets = [...new Set(serials)]
    if (!targets.length) throw new Error('请先选择运行目标设备')
    const previous = this.current
    for (const serial of targets) this.startingTargets.add(serial)
    try {
      // 手机端直连在拔线后不会出现在 ADB 列表，且没有安装 ADB 时也应能独立运行。
      const adbTargets = targets.filter((serial) => !serial.startsWith('direct:'))
      const online = new Set((adbTargets.length ? await listDevices() : [])
        .filter((device) => device.state === 'device').map((device) => device.serial))
      for (const serial of targets) {
        this.devices.require(serial)
        if (!serial.startsWith('direct:') && !online.has(serial)) throw new Error(`设备 ${serial} 已离线，请刷新设备列表`)
      }

      const id = `batch-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`
      const record: BatchRecord = {
        id, taskName: task.name, startedAt: new Date().toISOString(),
        devices: targets.map((serial) => ({ serial, status: 'pending' })), events: []
      }
      await mkdir(this.batchDir(id), { recursive: true })
      this.current = record
      await this.persist(record)
      const work = record.devices.map((device, index) => this.runDevice(record, task, device.serial, index))
      void Promise.allSettled(work).then(async () => {
        record.finishedAt = new Date().toISOString()
        await this.persist(record)
      })
      return record
    } catch (error) {
      if (!this.runners.size) this.current = previous
      throw error
    } finally { this.startingTargets.clear() }
  }

  /** 取消一台或整个批次；执行器在当前步骤返回后停止。 */
  cancel(serial?: string): void {
    if (serial) {
      const runner = this.runners.get(serial)
      if (!runner) throw new Error(`设备 ${serial} 没有正在运行的任务`)
      runner.cancel()
      return
    }
    for (const runner of this.runners.values()) runner.cancel()
  }

  /** 兼容已有调用；损坏的单条记录不影响其他批次展示。 */
  async history(): Promise<BatchRecord[]> { return (await this.readHistory(0, 100)).records }

  /** 历史列表每次仅载入二十批，IPC 不包含逐步事件。 */
  async historyPage(page: number): Promise<BatchPage> {
    if (!Number.isInteger(page) || page < 0) throw new Error('历史页码无效')
    const { records, hasMore } = await this.readHistory(page * 20, 20)
    return { items: records.map(summarize), hasMore }
  }

  /** 只读取所选设备的日志，并校验批次 ID 和设备归属。 */
  async events(batchId: string, serial: string): Promise<RunEvent[]> {
    if (typeof batchId !== 'string' || !/^batch-[A-Za-z0-9_-]+$/.test(batchId)) throw new Error('批次 ID 无效')
    if (typeof serial !== 'string' || !serial) throw new Error('设备序列号无效')
    const record = this.current?.id === batchId ? this.current : await this.readRecord(batchId)
    if (!record || !record.devices.some((device) => device.serial === serial)) throw new Error('批次或设备不存在')
    return record.events.filter((event) => event.serial === serial)
  }

  private async readHistory(offset: number, limit: number): Promise<{ records: BatchRecord[]; hasMore: boolean }> {
    const root = path.join(app.getPath('userData'), 'runs')
    let names: string[]
    try { names = (await readdir(root)).filter((name) => /^batch-[A-Za-z0-9_-]+$/.test(name)).sort().reverse() }
    catch { return { records: offset === 0 && this.current ? [this.current] : [], hasMore: false } }
    const pageNames = names.slice(offset, offset + limit)
    const hasMore = names.length > offset + limit
    const records = await Promise.all(pageNames.map(async (name) => {
      try {
        return this.current?.id === name ? this.current : await this.readRecord(name)
      }
      catch { return null }
    }))
    return { records: records.filter((record): record is BatchRecord => Boolean(record)), hasMore }
  }

  private async readRecord(batchId: string): Promise<BatchRecord> {
    const file = path.join(this.batchDir(batchId), 'batch.json')
    const record = JSON.parse(await readFile(file, 'utf8')) as BatchRecord
    if (record.id !== batchId || !Array.isArray(record.devices) || !Array.isArray(record.events) || typeof record.startedAt !== 'string') {
      throw new Error('批次记录损坏')
    }
    if (!record.finishedAt) {
      // 主进程退出后旧执行器已不存在，恢复时把悬挂状态明确标为中断。
      record.finishedAt = new Date().toISOString()
      for (const device of record.devices) {
        if (device.status === 'pending' || device.status === 'running') {
          device.status = 'failure'
          device.error = '应用已退出，运行中断'
        }
      }
      await writeFile(file, JSON.stringify(record, null, 2), 'utf8')
    }
    return record
  }

  private async runDevice(record: BatchRecord, task: AutomationTask, serial: string, index: number): Promise<void> {
    const device = record.devices[index]
    const runner = new TaskRunner()
    const runDir = path.join(this.batchDir(record.id), `device-${index + 1}`)
    this.runners.set(serial, runner)
    device.status = 'running'
    device.runDir = runDir
    this.queuePersist(record)
    try {
      await runner.run(task, this.devices.require(serial), (event) => {
        record.events.push(event)
        if (event.kind === 'step') device.stepIndex = event.stepIndex
        if (event.kind === 'failure') device.error = event.message
        if (event.kind === 'success' || event.kind === 'partial' || event.kind === 'failure' || event.kind === 'cancelled') device.status = event.kind
        this.emit(event)
        this.queuePersist(record)
      }, { batchId: record.id, serial, runDir })
    } catch (error) {
      const hasFailure = record.events.some((event) => event.serial === serial && event.kind === 'failure')
      device.status = 'failure'
      device.error = error instanceof Error ? error.message : String(error)
      if (!hasFailure) {
        const event: RunEvent = { kind: 'failure', at: new Date().toISOString(), message: device.error, serial, batchId: record.id, runDir }
        record.events.push(event)
        this.emit(event)
      }
    } finally {
      this.runners.delete(serial)
      await this.persist(record)
    }
  }

  private batchDir(id: string): string { return path.join(app.getPath('userData'), 'runs', id) }

  private queuePersist(record: BatchRecord): void {
    if (this.pendingWrite) return
    // 多设备每一步都会上报事件，合并短时间内的批次摘要写入；逐设备完整事件仍即时写入 jsonl。
    this.pendingWrite = setTimeout(() => {
      this.pendingWrite = null
      void this.persist(record).catch(() => {})
    }, 100)
  }

  private persist(record: BatchRecord): Promise<void> {
    if (this.pendingWrite) { clearTimeout(this.pendingWrite); this.pendingWrite = null }
    const snapshot = JSON.stringify(record, null, 2)
    const target = path.join(this.batchDir(record.id), 'batch.json')
    this.writeQueue = this.writeQueue.catch(() => {}).then(() => writeFile(target, snapshot, 'utf8'))
    return this.writeQueue
  }
}

/** IPC 投影不带事件数组，保留原有 batch.json 结构。 */
export function summarize(record: BatchRecord): BatchSummary {
  const { events: _events, ...summary } = record
  return summary
}
