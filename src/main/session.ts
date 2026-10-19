import { app } from 'electron'
import { randomBytes } from 'node:crypto'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { AgentClient } from './agent-client'
import { adb, adbSpawn, listDevices, onDevice } from './adb'
import { parseHierarchy } from './hierarchy'
import type { HierarchySnapshot, Selector } from '../shared/types'

const AGENT_PORT = 39827
const RUNNER = 'dev.androidautodesk.host.test/androidx.test.runner.AndroidJUnitRunner'

export class DeviceSession {
  readonly serial: string
  private process: ChildProcessWithoutNullStreams | null = null
  private client: AgentClient | null = null
  private touchClient: AgentClient | null = null
  private hostPort: number | null = null
  private token: string | null = null

  private constructor(serial: string) { this.serial = serial }

  static async open(serial: string): Promise<DeviceSession> {
    const device = (await listDevices()).find((item) => item.serial === serial)
    if (!device) throw new Error('设备已断开')
    if (!device.usb) throw new Error('第一版仅支持 USB 连接')
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
    if (!Number.isFinite(sdk) || sdk < 29) throw new Error('需要 Android 10 或更高版本')
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
    this.process = adbSpawn(onDevice(this.serial, ['shell', 'am', 'instrument', '-w', '-r', '-e', 'token', token, RUNNER]))
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

  /**
   * 投屏操控专用的第二条 agent 连接：与命令通道隔离，
   * 触摸事件不会被 wait/snapshot 等长操作阻塞。首次调用时懒建立。
   * @throws 会话未就绪或 5s 内连接失败时抛出
   */
  async touchClientOrConnect(): Promise<AgentClient> {
    if (this.touchClient) return this.touchClient
    if (!this.hostPort || !this.token) throw new Error('手机辅助服务未连接')
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) {
      try {
        this.touchClient = await AgentClient.connect(this.hostPort, this.token)
        return this.touchClient
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
    }
    throw new Error('触摸通道连接超时')
  }

  async count(selector: Selector): Promise<number> { return this.agent().count(selector) }

  async screenshot(): Promise<Buffer> {
    const png = await adb(onDevice(this.serial, ['exec-out', 'screencap', '-p']), 15000)
    if (png.length < 24 || png.toString('ascii', 1, 4) !== 'PNG') throw new Error('手机截图失败')
    return png
  }

  async snapshot(): Promise<HierarchySnapshot> {
    const xml = await this.agent().request<string>('snapshot', {}, 15000)
    const nodes = parseHierarchy(xml)
    // 根窗口 bounds 的并集即当前方向的屏幕尺寸，省去一次数百毫秒的 screencap
    const width = Math.max(0, ...nodes.filter((node) => node.depth === 0).map((node) => node.bounds.right))
    const height = Math.max(0, ...nodes.filter((node) => node.depth === 0).map((node) => node.bounds.bottom))
    if (width <= 0 || height <= 0) throw new Error('控件层级为空，无法确定屏幕尺寸')
    return { nodes, width, height, capturedAt: new Date().toISOString() }
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
    try { await this.client?.request('shutdown', {}, 1000) } catch { /* best effort */ }
    this.client?.close()
    this.client = null
    this.touchClient?.close()
    this.touchClient = null
    this.process?.kill()
    this.process = null
    if (this.hostPort) {
      try { await adb(onDevice(this.serial, ['forward', '--remove', `tcp:${this.hostPort}`]), 3000) } catch { /* disconnected */ }
      this.hostPort = null
    }
  }
}
