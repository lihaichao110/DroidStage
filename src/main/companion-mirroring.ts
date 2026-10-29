/**
 * 手机端直连投屏：把已认证 TLS 事件转换为现有画面 IPC，并发送无障碍控制命令。
 */
import type { BrowserWindow } from 'electron'
import type { MirrorStatus, Point, ScrollInput, TouchInput } from '../shared/types'
import type { CompanionSession } from './companion-session'

type PhysicalSize = { physicalWidth: number; physicalHeight: number }

export class CompanionMirrorService {
  private session: CompanionSession | null = null
  private window: BrowserWindow | null = null
  private serial = ''
  private physical: PhysicalSize | null = null
  private down: { point: Point; at: number } | null = null
  private queue: Promise<unknown> = Promise.resolve()

  /** 开始视频编码，仅当首帧真正到达后标记为推流中。 */
  start(window: BrowserWindow, session: CompanionSession, quality: 'editor' | 'wall'): Promise<void> {
    return this.enqueue(async () => {
      await this.doStop()
      this.window = window
      this.session = session
      this.serial = session.serial
      this.status({ state: 'starting' })
      const pending: string[] = []
      let ready = false
      session.onVideo((event) => {
        if (!ready) { if (pending.length < 64) pending.push(event.data); return }
        this.chunk(event.data)
      })
      try {
        const size = await session.agent().request<PhysicalSize>('mirrorStart',
          quality === 'wall' ? { maxSize: 640, bitRate: 1_500_000, fps: 15 } : { maxSize: 1024, bitRate: 6_000_000, fps: 60 }, 15000)
        if (!size.physicalWidth || !size.physicalHeight) throw new Error('手机端未返回屏幕尺寸')
        this.physical = size
        ready = true
        for (const data of pending) this.chunk(data)
      } catch (error) {
        session.onVideo(null)
        this.status({ state: 'error', message: error instanceof Error ? error.message : String(error) })
        throw error
      }
    })
  }

  stop(): Promise<void> { return this.enqueue(() => this.doStop()) }

  private async doStop(): Promise<void> {
    const session = this.session
    this.session = null
    this.down = null
    this.physical = null
    this.sentFirstFrame = false
    this.sentKeyframe = false
    session?.onVideo(null)
    if (session?.isAlive()) await session.agent().request('mirrorStop', {}, 3000).catch(() => {})
    if (session) this.status({ state: 'stopped' })
  }

  /** 视频坐标先按首帧的物理尺寸换算，再通过无障碍手势注入。 */
  async touch(input: TouchInput): Promise<void> {
    const session = this.requireSession()
    const point = input.action === 'move' ? input.points.at(-1) : input
    if (!point) return
    const mapped = this.map(point, input.frameWidth, input.frameHeight)
    if (input.action === 'down') { this.down = { point: mapped, at: Date.now() }; return }
    if (input.action === 'move') return
    const start = this.down
    this.down = null
    if (!start || input.action === 'cancel') return
    const moved = Math.abs(start.point.x - mapped.x) + Math.abs(start.point.y - mapped.y) > 12
    if (moved) await session.agent().request('swipe', { from: start.point, to: mapped, durationMs: Math.max(80, Date.now() - start.at) })
    else await session.agent().request('tap', { point: mapped })
  }

  async scroll(input: ScrollInput): Promise<void> {
    const session = this.requireSession()
    const point = this.map(input, input.frameWidth, input.frameHeight)
    const distance = Math.max(80, Math.min(600, Math.abs(input.dy) * 120))
    const end = { x: point.x, y: Math.max(0, point.y + (input.dy > 0 ? -distance : distance)) }
    await session.agent().request('swipe', { from: point, to: end, durationMs: 300 })
  }

  async key(key: 'back' | 'home'): Promise<void> { await this.requireSession().agent().request('key', { key }) }

  private requireSession(): CompanionSession {
    if (!this.session?.isAlive()) throw new Error('手机端投屏已断开，请重新连接')
    return this.session
  }

  private map(point: Point, width: number, height: number): Point {
    if (!this.physical || width <= 0 || height <= 0) throw new Error('投屏画面尺寸无效')
    return { x: Math.round(point.x * this.physical.physicalWidth / width),
      y: Math.round(point.y * this.physical.physicalHeight / height) }
  }

  private chunk(encoded: string): void {
    const window = this.window
    if (!window || window.isDestroyed() || !this.physical) return
    const contents = window.webContents
    if (contents.isDestroyed()) return
    const bytes = Buffer.from(encoded, 'base64')
    if (!this.sentFirstFrame) {
      this.sentFirstFrame = true
      contents.send('mirror:stream', { serial: this.serial, ...this.physical })
    }
    contents.send('mirror:chunk', { serial: this.serial, bytes: new Uint8Array(bytes) })
    // 编码器先输出 SPS/PPS；收到真正的 IDR 关键帧后才能报告画面已开始。
    if (!this.sentKeyframe && bytes.length > 5 && bytes.subarray(0, 4).equals(Buffer.from([0, 0, 0, 1])) &&
      (bytes[4] & 0x1f) === 5) {
      this.sentKeyframe = true
      this.status({ state: 'streaming' })
    }
  }

  private sentFirstFrame = false
  private sentKeyframe = false
  private status(status: MirrorStatus): void {
    const window = this.window
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send('mirror:status', { serial: this.serial, status })
    }
  }

  private enqueue(job: () => Promise<void>): Promise<void> {
    const run = this.queue.then(job)
    this.queue = run.catch(() => {})
    return run
  }
}
