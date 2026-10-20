/**
 * 投屏编排：管理 scrcpy-server 生命周期，把视频字节流经 IPC 结构化克隆下发渲染进程，
 * 并广播投屏状态。设备物理分辨率在启动时查询一次并随流起始消息下发。
 * 视频字节不走 MessagePort：实测 sandbox 渲染进程收得到端口对象但收不到端口消息，
 * 常规 IPC 通道（与状态广播同路）在此环境下被验证可靠。
 */
import type { BrowserWindow } from 'electron'
import { adb, onDevice } from './adb'
import { ScrcpyServer, type ScrcpyOptions } from './scrcpy-server'
import type { MirrorStatus } from '../shared/types'

export class MirrorService {
  private server: ScrcpyServer | null = null
  private window: BrowserWindow | null = null
  private serial: string | null = null
  // start/stop 串行队列：渲染端重载或 React 开发模式会连发 start/stop，并发交错
  // 会泄漏 server 进程、或让旧实例的退出回调干扰新一轮投屏，必须按到达顺序执行
  private queue: Promise<unknown> = Promise.resolve()

  /**
   * 开始投屏；已在投屏时先停止再重启（渲染进程重载后订阅已重建，重启以重新下发流）。
   * @throws 设备物理分辨率读取失败或 server 启动失败时抛出
   */
  start(window: BrowserWindow, serial: string, options?: ScrcpyOptions): Promise<void> {
    return this.enqueue(() => this.doStart(window, serial, options))
  }

  stop(): Promise<void> {
    return this.enqueue(() => this.doStop(true))
  }

  /**
   * 向当前投屏实例的控制通道写入一条控制消息（与 start/stop 不同，不排队：注入事件
   * 必须按到达顺序尽快下发，且实现本身是同步写 socket，无并发交错风险）。
   * @throws 投屏未启动时抛出
   */
  sendControl(message: Buffer): void {
    if (!this.server) throw new Error('投屏未启动')
    this.server.sendControl(message)
  }

  private enqueue(job: () => Promise<void>): Promise<void> {
    const run = this.queue.then(job)
    // 队列只保证顺序，前一次失败不阻断后续操作
    this.queue = run.catch(() => {})
    return run
  }

  private async doStart(window: BrowserWindow, serial: string, options?: ScrcpyOptions): Promise<void> {
    console.log(`[投屏] 启动：${serial}`)
    await this.doStop(false)
    this.window = window
    this.serial = serial
    this.status({ state: 'starting' })
    const physical = await readPhysicalSize(serial)
    const server = new ScrcpyServer(serial, options)
    let delivered = false
    server.onData = (chunk: Buffer) => {
      const contents = window.webContents
      // 窗口销毁（退出中）后停止推送；server 由 before-quit 的 stop 统一清理
      if (contents.isDestroyed()) return
      if (!delivered) {
        delivered = true
        // 流起始消息先于首块数据发出（同一 webContents 的 IPC 按发送顺序送达）
        contents.send('mirror:stream', { serial, ...physical })
        this.status({ state: 'streaming' })
        console.log(`[投屏] 开始推流：${physical.physicalWidth}x${physical.physicalHeight}，首块 ${chunk.length}B`)
      }
      // Buffer 底层可能是共享池，克隆为独立视图再经结构化克隆下发（每块一次拷贝，开销可忽略）
      contents.send('mirror:chunk', { serial, bytes: new Uint8Array(chunk) })
    }
    server.onExit = (message) => {
      // 只清理本次实例的引用：this.server 可能已被新一轮 start 接管
      if (this.server === server) this.server = null
      console.log(`[投屏] 已结束${message ? `：${message}` : ''}`)
      this.status(message ? { state: 'error', message } : { state: 'stopped' })
    }
    this.server = server
    try {
      await server.start()
    } catch (error) {
      // 失败的 server 必须完整清理（杀进程、删转发），只置空引用会在设备上留下僵尸 app_process
      if (this.server === server) this.server = null
      await server.stop().catch(() => { /* 设备已拔出时忽略清理错误 */ })
      const text = error instanceof Error ? error.message : String(error)
      console.log(`[投屏] 启动失败：${text}`)
      this.status({ state: 'error', message: text })
      throw error
    }
  }

  private async doStop(emitStatus: boolean): Promise<void> {
    const server = this.server
    this.server = null
    if (server) await server.stop()
    // 主动 stop 无 server 时也广播停止；doStart 内部的清理则不打扰 starting 状态
    else if (emitStatus) this.status({ state: 'stopped' })
  }

  /** 状态只随最新事件走；窗口销毁（退出中）时静默丢弃。 */
  private status(value: MirrorStatus): void {
    const contents = this.window?.webContents
    if (contents && !contents.isDestroyed() && this.serial) contents.send('mirror:status', { serial: this.serial, status: value })
  }
}

/**
 * 读取设备物理分辨率（竖屏基准），wm size 可能带 Override size（改过分辨率），优先生效值在后。
 * @returns 随投屏流下发的元数据
 * @throws 输出无法解析时抛出
 */
async function readPhysicalSize(serial: string): Promise<{ physicalWidth: number; physicalHeight: number }> {
  const output = (await adb(onDevice(serial, ['shell', 'wm', 'size']), 5000)).toString('utf8')
  const matches = [...output.matchAll(/(\d+)x(\d+)/g)]
  const last = matches[matches.length - 1]
  const width = last ? Number(last[1]) : 0
  const height = last ? Number(last[2]) : 0
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`无法读取设备分辨率：${output.trim() || 'wm size 无输出'}`)
  }
  return { physicalWidth: width, physicalHeight: height }
}
