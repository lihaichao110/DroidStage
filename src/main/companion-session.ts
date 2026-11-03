/**
 * 手机端直连会话：以 TLS 代理代替 ADB 执行任务、截图和投屏指令。
 */
import { AgentClient } from './agent-client'
import { connectCompanion, type PairedCompanion, type VideoEvent } from './companion-client'
import { parseHierarchy } from './hierarchy'
import type { HierarchySnapshot, MatchInfo, Selector } from '../shared/types'

export class CompanionSession {
  readonly serial: string
  readonly paired: PairedCompanion
  private client: AgentClient | null = null
  private quickClient: AgentClient | null = null
  private quickConnecting: Promise<AgentClient> | null = null
  private videoListener: ((event: VideoEvent) => void) | null = null
  private snapshotInFlight: Promise<HierarchySnapshot> | null = null
  private heartbeat: NodeJS.Timeout | null = null
  private isClosed = false

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

  /**
   * 查询匹配控件数量，并按需等待手机端控件树刷新。
   * 手机端单连接串行执行，count 若与 snapshot、投屏事件同连接会排队等成超时，
   * 因此交互式快查询走独立的第二连接（手机端每连接一线程，互不阻塞）。
   * @param selector 控件定位条件
   * @param waitMs 首次未命中时的最长等待时间；零表示立即返回
   * @returns 最终匹配数量
   */
  async count(selector: Selector, waitMs = 0): Promise<number> {
    return (await this.quickAgent()).count(selector, waitMs)
  }

  /**
   * 查询匹配控件的序号与屏幕边界，供定位条件细化参考。
   * @param selector 控件定位条件
   * @returns 匹配项列表，序号从 1 开始
   */
  async matches(selector: Selector): Promise<MatchInfo[]> {
    return (await this.quickAgent()).request<MatchInfo[]>('inspectMatches', { selector })
  }

  /** 取快查询通道：懒建立、断线后下次自动重连，并发调用共享同一次连接过程。 */
  private async quickAgent(): Promise<AgentClient> {
    if (this.quickClient?.isConnected()) return this.quickClient
    if (!this.quickConnecting) {
      this.quickConnecting = this.connectQuick().finally(() => { this.quickConnecting = null })
    }
    return this.quickConnecting
  }

  /** 建立快查询通道；不挂 video 监听，投屏视频帧只属于主连接。 */
  private async connectQuick(): Promise<AgentClient> {
    // connectCompanion 自带 TLS 证书校验、status 握手与权限校验，失败会抛中文错误
    const client = await connectCompanion(this.paired)
    // 会话可能在握手期间被关闭，迟到的连接直接丢弃，避免关闭后泄漏存活 socket
    if (this.isClosed) { client.close(); throw new Error('手机端直连服务未连接') }
    this.quickClient = client
    return client
  }

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
    // 与 USB 会话不同，这里不做超时后的主连接重建：重建会撕裂投屏视频流，
    // 且快查询已走独立通道不受影响，主连接留待心跳失败时统一判定失效。
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
    this.isClosed = true
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = null
    this.videoListener = null
    this.client?.close()
    this.client = null
    this.quickClient?.close()
    this.quickClient = null
  }
}
