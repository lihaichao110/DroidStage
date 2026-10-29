/**
 * 手机端直连会话：以 TLS 代理代替 ADB 执行任务、截图和投屏指令。
 */
import { AgentClient } from './agent-client'
import { connectCompanion, type PairedCompanion, type VideoEvent } from './companion-client'
import { parseHierarchy } from './hierarchy'
import type { HierarchySnapshot, Selector } from '../shared/types'

export class CompanionSession {
  readonly serial: string
  readonly paired: PairedCompanion
  private client: AgentClient | null = null
  private videoListener: ((event: VideoEvent) => void) | null = null
  private snapshotInFlight: Promise<HierarchySnapshot> | null = null
  private heartbeat: NodeJS.Timeout | null = null

  private constructor(paired: PairedCompanion) { this.paired = paired; this.serial = paired.serial }

  /** 验证证书、密钥和所需权限后才把会话标为可用。 */
  static async open(paired: PairedCompanion): Promise<CompanionSession> {
    const session = new CompanionSession(paired)
    session.client = await connectCompanion(paired, (event) => session.videoListener?.(event))
    session.startHeartbeat()
    return session
  }

  /** 持续发出少量局域网流量，并在心跳失败时及时撤销已连接状态。 */
  private startHeartbeat(): void {
    this.heartbeat = setInterval(() => {
      const client = this.client
      if (!client || !client.isConnected()) return
      void client.request('ping', {}, 5000).catch(() => client.close())
    }, 15000)
  }

  agent(): AgentClient {
    if (!this.client) throw new Error('手机端直连服务未连接')
    return this.client
  }

  isAlive(): boolean { return this.client?.isConnected() ?? false }
  async count(selector: Selector, waitMs = 0): Promise<number> { return this.agent().count(selector, waitMs) }

  /** 经已授权的录屏服务取得真实 PNG；缺少画面时手机端会报错。 */
  async screenshot(): Promise<Buffer> {
    const encoded = await this.agent().request<string>('screenshot', {}, 10000)
    const png = Buffer.from(encoded, 'base64')
    if (png.length < 24 || png.toString('ascii', 1, 4) !== 'PNG') throw new Error('手机端截图数据无效')
    return png
  }

  async snapshot(): Promise<HierarchySnapshot> {
    if (!this.snapshotInFlight) this.snapshotInFlight = this.takeSnapshot().finally(() => { this.snapshotInFlight = null })
    return this.snapshotInFlight
  }

  private async takeSnapshot(): Promise<HierarchySnapshot> {
    const xml = await this.agent().request<string>('snapshot', {}, 30000)
    const nodes = parseHierarchy(xml)
    const width = Math.max(0, ...nodes.filter((node) => node.depth === 0).map((node) => node.bounds.right))
    const height = Math.max(0, ...nodes.filter((node) => node.depth === 0).map((node) => node.bounds.bottom))
    if (width <= 0 || height <= 0) throw new Error('控件层级为空，无法确定屏幕尺寸')
    return { nodes, width, height, capturedAt: new Date().toISOString() }
  }

  async launch(packageName: string): Promise<void> {
    await this.agent().request('launch', { packageName })
  }

  /** 投屏复用已认证连接，视频事件直接分发给本会话的镜像实例。 */
  onVideo(listener: ((event: VideoEvent) => void) | null): void { this.videoListener = listener }

  async close(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = null
    this.videoListener = null
    this.client?.close()
    this.client = null
  }
}
