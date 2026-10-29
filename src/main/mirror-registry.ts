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

  /** 为指定设备开启投屏；监看画面每页最多六路。 */
  async start(window: BrowserWindow, serial: string, quality: 'editor' | 'wall', companion?: CompanionSession): Promise<void> {
    if (quality === 'wall' && !this.wall.has(serial) && this.wall.size >= 6) throw new Error('设备画面每页最多同时显示 6 台')
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
    this.wall.delete(serial)
    const mirror = this.mirrors.get(serial)
    await mirror?.stop()
    await this.companions.get(serial)?.stop()
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
