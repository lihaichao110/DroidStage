/**
 * 按设备管理投屏实例，并限制监看页同时启用的视频流数量。
 */
import type { BrowserWindow } from 'electron'
import { MirrorService } from './mirroring'
import { CompanionMirrorService } from './companion-mirroring'
import type { CompanionSession } from './companion-session'
import type { ScrollInput, TouchInput } from '../shared/types'
import { DEFAULT_SCRCPY_OPTIONS } from './scrcpy-server'

const WALL_OPTIONS = { maxSize: 640, bitRate: 1_500_000, maxFps: 15 }

export class MirrorRegistry {
  private readonly mirrors = new Map<string, MirrorService>()
  private readonly companions = new Map<string, CompanionMirrorService>()
  private readonly wall = new Set<string>()
  private readonly stopping = new Map<string, Promise<void>>()

  /** 为指定设备开启投屏；工作台最多同时保留四路。 */
  async start(window: BrowserWindow, serial: string, quality: 'editor' | 'wall', companion?: CompanionSession): Promise<void> {
    if (this.stopping.has(serial)) await this.stopping.get(serial)
    // 切换焦点设备时，旧流异步关闭；等它真正释放后才能占用第四个名额。
    while (quality === 'wall' && !this.wall.has(serial) && this.wall.size >= 4) {
      const freeing = [...this.stopping].filter(([stoppingSerial]) => this.wall.has(stoppingSerial)).map(([, pending]) => pending)
      if (!freeing.length) break
      await Promise.race(freeing)
    }
    if (quality === 'wall' && !this.wall.has(serial) && this.wall.size >= 4) throw new Error('运行工作台最多同时监看 4 台设备')
    if (companion) {
      let mirror = this.companions.get(serial)
      if (!mirror) { mirror = new CompanionMirrorService(); this.companions.set(serial, mirror) }
      if (quality === 'wall') this.wall.add(serial)
      else this.wall.delete(serial)
      try { await mirror.start(window, companion, quality) }
      catch (error) { this.wall.delete(serial); throw error }
      return
    }
    let mirror = this.mirrors.get(serial)
    if (!mirror) { mirror = new MirrorService(); this.mirrors.set(serial, mirror) }
    if (quality === 'wall') this.wall.add(serial)
    else this.wall.delete(serial)
    try { await mirror.start(window, serial, quality === 'wall' ? WALL_OPTIONS : DEFAULT_SCRCPY_OPTIONS) }
    catch (error) { this.wall.delete(serial); throw error }
  }

  /** 停止单台设备投屏并释放其 ADB 转发。 */
  async stop(serial: string): Promise<void> {
    const pending = this.stopping.get(serial)
    if (pending) return pending
    const operation = (async () => {
      await this.mirrors.get(serial)?.stop()
      await this.companions.get(serial)?.stop()
      this.wall.delete(serial)
    })()
    this.stopping.set(serial, operation)
    try { await operation }
    finally { this.stopping.delete(serial) }
  }

  sendControl(serial: string, message: Buffer): void {
    const mirror = this.mirrors.get(serial)
    if (!mirror) throw new Error(`设备 ${serial} 的投屏未启动`)
    mirror.sendControl(message)
  }

  /** 手机端直连使用 JSON 指令；不经过 scrcpy/ADB 控制通道。 */
  touch(serial: string, input: TouchInput): Promise<void> {
    const mirror = this.companions.get(serial)
    if (!mirror) throw new Error('手机端投屏未启动')
    return mirror.touch(input)
  }
  scroll(serial: string, input: ScrollInput): Promise<void> {
    const mirror = this.companions.get(serial)
    if (!mirror) throw new Error('手机端投屏未启动')
    return mirror.scroll(input)
  }
  key(serial: string, key: 'back' | 'home'): Promise<void> {
    const mirror = this.companions.get(serial)
    if (!mirror) throw new Error('手机端投屏未启动')
    return mirror.key(key)
  }

  async stopAll(): Promise<void> { await Promise.all([...new Set([...this.mirrors.keys(), ...this.companions.keys()])].map((serial) => this.stop(serial))) }
}
