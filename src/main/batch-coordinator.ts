/**
 * 批次运行编排：同一任务独立并行运行在多个设备上，并保存可恢复的批次记录。
 */
import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AutomationTask, BatchRecord, RunEvent } from '../shared/types'
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
      const online = new Set((await listDevices()).filter((device) => device.state === 'device').map((device) => device.serial))
      for (const serial of targets) {
        this.devices.require(serial)
        if (!online.has(serial)) throw new Error(`设备 ${serial} 已离线，请刷新设备列表`)
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

  /** 从 runs 中读取历史批次；损坏的单条记录不影响其他批次展示。 */
  async history(): Promise<BatchRecord[]> {
    const root = path.join(app.getPath('userData'), 'runs')
    let names: string[]
    try { names = (await readdir(root)).filter((name) => name.startsWith('batch-')).sort().reverse().slice(0, 100) }
    catch { return this.current ? [this.current] : [] }
    const records = await Promise.all(names.map(async (name) => {
      try {
        const file = path.join(root, name, 'batch.json')
        const record = JSON.parse(await readFile(file, 'utf8')) as BatchRecord
        if (!record.finishedAt && record.id !== this.current?.id) {
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
      catch { return null }
    }))
    return records.filter((record): record is BatchRecord => Boolean(record)).map((record) => record.id === this.current?.id ? this.current : record)
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
