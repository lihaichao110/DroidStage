/**
 * 设备会话管理：安装并连接手机代理，提供启动应用、控件查询和快照能力。
 */
import { app } from 'electron'
import { randomBytes } from 'node:crypto'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { AgentClient } from './agent-client'
import { adb, adbSpawn, listDevices, onDevice } from './adb'
import { parseHierarchy } from './hierarchy'
import type { HierarchySnapshot, MatchInfo, Selector } from '../shared/types'

const AGENT_PORT = 39827
const RUNNER = 'dev.androidautodesk.host.test/androidx.test.runner.AndroidJUnitRunner'

/** 判断错误是否意味着主连接不可信：超时未响应或 socket 已断，值得重建通道。 */
function isConnectionSuspect(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('操作超时') || message.includes('已断开') || message.includes('连接已关闭')
}

export class DeviceSession {
  readonly serial: string
  private process: ChildProcessWithoutNullStreams | null = null
  private client: AgentClient | null = null
  private quickClient: AgentClient | null = null
  private quickConnecting: Promise<AgentClient> | null = null
  private hostPort: number | null = null
  private token: string | null = null
  private snapshotInFlight: Promise<HierarchySnapshot> | null = null
  private reconnecting: Promise<void> | null = null
  private isClosed = false

  private constructor(serial: string) { this.serial = serial }

  static async open(serial: string): Promise<DeviceSession> {
    const device = (await listDevices()).find((item) => item.serial === serial)
    if (!device) throw new Error('设备已断开')
    if (device.state !== 'device') throw new Error(device.state === 'unauthorized' ? '请在手机上允许 USB 调试授权' : `设备状态：${device.state}`)
    const session = new DeviceSession(serial)
    try {
      await session.initialize()
      return session
    } catch (error) {
      await session.close()
      throw error
    }
  }

  private async initialize(): Promise<void> {
    const sdk = Number((await adb(onDevice(this.serial, ['shell', 'getprop', 'ro.build.version.sdk']))).toString().trim())
    if (!Number.isInteger(sdk) || sdk < 1) throw new Error('无法读取手机的 Android API 等级')
    if (sdk < 29) throw new Error(`当前设备为 Android API ${sdk}；自动化辅助 APK 要求 Android 10/API 29 或更高版本`)
    const root = app.isPackaged ? path.join(process.resourcesPath, 'agent') : path.join(app.getAppPath(), 'assets', 'agent')
    const hostApk = path.join(root, 'host.apk')
    const testApk = path.join(root, 'test.apk')
    if (!existsSync(hostApk) || !existsSync(testApk)) throw new Error('安装包缺少手机辅助 APK')
    try {
      await this.installApks(hostApk, testApk)
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('INSTALL_FAILED_UPDATE_INCOMPATIBLE')) throw error
      for (const packageName of ['dev.androidautodesk.host.test', 'dev.androidautodesk.host']) {
        try { await adb(onDevice(this.serial, ['uninstall', packageName]), 15000) } catch { /* already removed */ }
      }
      await this.installApks(hostApk, testApk)
    }
    const forward = (await adb(onDevice(this.serial, ['forward', 'tcp:0', `tcp:${AGENT_PORT}`]))).toString('utf8').trim()
    this.hostPort = Number(forward)
    if (!Number.isInteger(this.hostPort) || this.hostPort <= 0) throw new Error('ADB 端口映射失败')
    const token = randomBytes(24).toString('hex')
    this.token = token
    // 测试 APK 也包含模拟列表用例；正式会话只启动服务，避免退出服务后自动操作测试页面。
    this.process = await adbSpawn(onDevice(this.serial, ['shell', 'am', 'instrument', '-w', '-r',
      '-e', 'class', 'dev.androidautodesk.host.AgentTest#serve', '-e', 'token', token, RUNNER]))
    let instrumentOutput = ''
    this.process.stdout.on('data', (data: Buffer) => { instrumentOutput = (instrumentOutput + data.toString('utf8')).slice(-5000) })
    this.process.stderr.on('data', (data: Buffer) => { instrumentOutput = (instrumentOutput + data.toString('utf8')).slice(-5000) })
    const deadline = Date.now() + 15000
    while (Date.now() < deadline) {
      if (this.process.exitCode !== null) throw new Error(`辅助服务启动失败：${instrumentOutput.trim()}`)
      try {
        this.client = await AgentClient.connect(this.hostPort, token)
        await this.client.request('ping', {}, 1000)
        return
      } catch {
        this.client?.close()
        this.client = null
        await new Promise((resolve) => setTimeout(resolve, 350))
      }
    }
    throw new Error(`手机辅助服务启动超时：${instrumentOutput.trim()}`)
  }

  private async installApks(hostApk: string, testApk: string): Promise<void> {
    for (const args of [['install', '-r', hostApk], ['install', '-r', '-t', testApk]]) {
      const output = (await adb(onDevice(this.serial, args), 60000)).toString('utf8')
      if (!output.includes('Success')) throw new Error(output.trim() || '辅助 APK 安装失败')
    }
  }

  agent(): AgentClient {
    if (!this.client) throw new Error('手机辅助服务未连接')
    return this.client
  }

  /** 代理 socket 或 instrument 进程退出后立即把会话视为失效。 */
  isAlive(): boolean { return Boolean(this.client?.isConnected() && this.process && this.process.exitCode === null) }

  /**
   * 查询匹配控件数量，并按需等待手机端控件树刷新。
   * 手机端单连接串行执行，count 若与 snapshot 等长命令同连接会排队等成超时，
   * 因此这类交互式快查询走独立的第二连接（手机端每连接一线程，互不阻塞）。
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

  /** 建立并握手验证快查询通道；失败时明确报错，绝不静默降级回可能正忙的主连接。 */
  private async connectQuick(): Promise<AgentClient> {
    if (!this.hostPort || !this.token || this.isClosed) throw new Error('手机辅助服务未连接')
    this.quickClient?.close()
    let client: AgentClient
    try {
      client = await AgentClient.connect(this.hostPort, this.token)
    } catch {
      throw new Error('快查询通道连接失败，请重新连接设备')
    }
    try {
      await client.request('ping', {}, 1000)
    } catch (error) {
      client.close()
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(`快查询通道握手失败：${reason}`)
    }
    // 会话可能在握手期间被关闭，迟到的连接直接丢弃，避免关闭后泄漏存活 socket
    if (this.isClosed) { client.close(); throw new Error('手机辅助服务未连接') }
    this.quickClient = client
    return client
  }

  async screenshot(): Promise<Buffer> {
    const png = await adb(onDevice(this.serial, ['exec-out', 'screencap', '-p']), 15000)
    if (png.length < 24 || png.toString('ascii', 1, 4) !== 'PNG') throw new Error('手机截图失败')
    return png
  }

  /**
   * 读取当前控件层级快照。
   * 手机端单连接串行执行命令，并发 snapshot 只会在手机端排队堆积并连环超时，
   * 因此在途请求期间复用同一次结果，落定后才允许发起下一次。
   */
  async snapshot(): Promise<HierarchySnapshot> {
    if (!this.snapshotInFlight) {
      this.snapshotInFlight = this.takeSnapshot().finally(() => { this.snapshotInFlight = null })
    }
    return this.snapshotInFlight
  }

  private async takeSnapshot(): Promise<HierarchySnapshot> {
    try {
      // 复杂界面（WebView 多、动效不停）的层级导出是对前台 App 的同步遍历，可超过 15 秒
      const xml = await this.agent().request<string>('snapshot', {}, 30000)
      const nodes = parseHierarchy(xml)
      // 根窗口 bounds 的并集即当前方向的屏幕尺寸，省去一次数百毫秒的 screencap
      const width = Math.max(0, ...nodes.filter((node) => node.depth === 0).map((node) => node.bounds.right))
      const height = Math.max(0, ...nodes.filter((node) => node.depth === 0).map((node) => node.bounds.bottom))
      if (width <= 0 || height <= 0) throw new Error('控件层级为空，无法确定屏幕尺寸')
      return { nodes, width, height, capturedAt: new Date().toISOString() }
    } catch (error) {
      // 超时或断线说明主连接可能已被卡死的导出永久占住（迟到响应会被丢弃且不自愈），
      // 先重建干净通道再抛出原错误，让下一次刷新层级有可用连接；
      // 重建失败不掩盖根因，仍抛原始错误。
      if (isConnectionSuspect(error)) await this.reconnect().catch(() => {})
      throw error
    }
  }

  /** 重建主连接；在途守卫避免并发失败触发重复重建。 */
  private async reconnect(): Promise<void> {
    if (!this.reconnecting) {
      this.reconnecting = this.reconnectMain().finally(() => { this.reconnecting = null })
    }
    return this.reconnecting
  }

  private async reconnectMain(): Promise<void> {
    if (!this.hostPort || !this.token || this.isClosed) return
    this.client?.close()
    const client = await AgentClient.connect(this.hostPort, this.token)
    await client.request('ping', {}, 1000)
    // 会话可能在重建期间被关闭：丢弃迟到连接，保持关闭后的干净状态
    if (this.isClosed) { client.close(); return }
    this.client = client
  }

  async launch(packageName: string): Promise<void> {
    try {
      const output = (await adb(onDevice(this.serial, ['shell', 'monkey', '-p', packageName, '-c', 'android.intent.category.LAUNCHER', '1']), 15000)).toString('utf8')
      if (!output.includes('Events injected: 1')) throw new Error(`无法启动 App：${packageName}`)
    } catch (error) {
      // monkey 找不到包或无可启动 Activity 时以非零码退出并回显英文参数，
      // 统一换成带排查方向的中文提示，避免用户面对原始 monkey 输出
      if (error instanceof Error && error.message.includes('Events injected')) throw error
      throw new Error(`无法启动 App：${packageName}。请确认包名完整且手机已安装（如抖音为 com.ss.android.ugc.aweme）`)
    }
  }

  async close(): Promise<void> {
    this.isClosed = true
    try { await this.client?.request('shutdown', {}, 1000) } catch { /* best effort */ }
    this.client?.close()
    this.client = null
    // shutdown 停的是手机端整个服务，快通道随主通道一起作废即可
    this.quickClient?.close()
    this.quickClient = null
    this.process?.kill()
    this.process = null
    if (this.hostPort) {
      try { await adb(onDevice(this.serial, ['forward', '--remove', `tcp:${this.hostPort}`]), 3000) } catch { /* disconnected */ }
      this.hostPort = null
    }
  }
}
