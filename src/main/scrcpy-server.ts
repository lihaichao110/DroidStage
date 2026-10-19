/**
 * scrcpy-server 设备端投屏服务的启动与视频流接入：
 * push 二进制、建立端口转发、以 app_process 拉起 server 并读回纯 H.264 字节流。
 */
import { randomInt } from 'node:crypto'
import { existsSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { app } from 'electron'
import { adb, adbSpawn, onDevice } from './adb'

/** 必须与 assets/mirroring 内二进制的版本完全一致：server 启动时会逐字符比对客户端版本。 */
export const SCRCPY_VERSION = '5.0.1'

const SERVER_CLASS = 'com.genymobile.scrcpy.Server'
// 推到 /data/local/tmp 的固定路径：二进制随版本入库，重复 push 只是幂等覆盖
const DEVICE_JAR = '/data/local/tmp/autodesk-scrcpy-server.jar'

export type ScrcpyOptions = { maxSize: number; bitRate: number; maxFps: number }

/** 默认编码参数：检视面板宽约 550px，1024 档清晰度足够；6Mbps/60fps 兼顾流畅与码率。 */
export const DEFAULT_SCRCPY_OPTIONS: ScrcpyOptions = { maxSize: 1024, bitRate: 6_000_000, maxFps: 60 }

/**
 * 组装 server 启动参数（key=value，跟在版本号之后）。纯函数，供测试校验参数完整性。
 * @param scid 31 位随机整数，避免同设备多实例 socket 冲突
 */
export function buildServerArgs(scid: number, options: ScrcpyOptions): string[] {
  return [
    // scid 按 16 进制传递，server 端以 %08x 拼接 socket 名，两处进制必须一致
    `scid=${scid.toString(16)}`,
    'tunnel_forward=true', // 与 agent 一致走 adb forward，由桌面端主动连接
    'video=true',
    'audio=false',
    // 切分器与解码管线只认 H.264：显式固定编码，若 server 默认值漂移必须在启动时失败
    'video_codec=h264',
    'control=false', // 触摸注入走自研 agent 通道，不使用 scrcpy 控制协议
    'raw_stream=true', // 关闭 dummy byte/设备名/帧头等全部协议元数据，socket 即纯 H.264 流
    `max_size=${options.maxSize}`,
    `video_bit_rate=${options.bitRate}`,
    `max_fps=${options.maxFps}`,
    'stay_awake=true', // 投屏期间保持设备唤醒，适配自动化挂机场景
    'log_level=warn'
  ]
}

/** 定位本地 scrcpy-server 二进制：开发态在 assets，打包后在 resources；缺失必须报错。 */
export function scrcpyServerPath(): string {
  const root = app.isPackaged ? path.join(process.resourcesPath, 'mirroring') : path.join(app.getAppPath(), 'assets', 'mirroring')
  const file = path.join(root, 'scrcpy-server')
  if (!existsSync(file)) throw new Error('安装包缺少投屏组件 scrcpy-server（assets/mirroring）')
  return file
}

/**
 * 单台设备的 scrcpy-server 会话。仿 DeviceSession 的生命周期模式：
 * 长驻 adb shell 进程 + 端口转发，close/stop 时逆序清理。
 */
export class ScrcpyServer {
  /** 收到视频字节流时回调（首块数据即视为推流成功）。 */
  onData: (chunk: Buffer) => void = () => {}
  /** server 进程或 socket 意外结束时回调；主动 stop 时 message 为 null。 */
  onExit: (message: string | null) => void = () => {}

  private process: ChildProcessWithoutNullStreams | null = null
  private socket: net.Socket | null = null
  private probeSocket: net.Socket | null = null
  private hostPort: number | null = null
  private serverOutput = ''
  private stopping = false
  private readonly scid = randomInt(0, 0x8000_0000)

  constructor(private readonly serial: string, private readonly options: ScrcpyOptions = DEFAULT_SCRCPY_OPTIONS) {}

  /** server 监听的 abstract socket 名（与设备端 String.format("scrcpy_%08x", scid) 一致）。 */
  private get socketName(): string {
    return `scrcpy_${this.scid.toString(16).padStart(8, '0')}`
  }

  /**
   * 推送 server、建立转发并拉起进程，直到 video socket 返回首块数据。
   * @throws 组件缺失、端口映射失败、server 启动失败或 10s 内未推流时抛出
   */
  async start(): Promise<void> {
    await adb(onDevice(this.serial, ['push', scrcpyServerPath(), DEVICE_JAR]), 15000)
    const forward = (await adb(onDevice(this.serial, ['forward', 'tcp:0', `localabstract:${this.socketName}`]))).toString('utf8').trim()
    this.hostPort = Number(forward)
    if (!Number.isInteger(this.hostPort) || this.hostPort <= 0) throw new Error('投屏端口映射失败')
    // CLASSPATH 环境变量赋值需要 shell 解析，命令必须作为单个字符串传给 adb shell
    const args = [SCRCPY_VERSION, ...buildServerArgs(this.scid, this.options)].join(' ')
    this.process = adbSpawn(onDevice(this.serial, ['shell', `CLASSPATH=${DEVICE_JAR} app_process / ${SERVER_CLASS} ${args}`]))
    this.process.stdout.on('data', (data: Buffer) => { this.serverOutput = (this.serverOutput + data.toString('utf8')).slice(-5000) })
    this.process.stderr.on('data', (data: Buffer) => { this.serverOutput = (this.serverOutput + data.toString('utf8')).slice(-5000) })
    this.process.once('close', () => {
      this.cleanupSocket()
      this.onExit(this.stopping ? null : this.describeFailure())
    })
    this.process.once('error', (error) => {
      this.cleanupSocket()
      this.onExit(`投屏进程异常：${error.message}`)
    })
    await this.connectVideo()
  }

  private describeFailure(): string {
    const output = this.serverOutput.trim()
    if (!output) return '投屏服务已退出'
    // 华为/部分国产系统会主动清理 /data/local/tmp（jar 被删后 app_process 加载类失败以 SIGABRT 退出）
    if (/Aborted|ClassNotFound/i.test(output)) {
      return `投屏服务异常退出：${output}。部分华为/小米系统会定期清理 /data/local/tmp，请点击重新投屏（会重新推送组件）`
    }
    return `投屏服务中断：${output}`
  }

  /**
   * 连接 video socket 直到收到首块数据。关键约束：server 的视频通道只 accept 一次，
   * 一旦某条连接被服务端 accept，桌面端绝不能主动放弃它（否则该连接作废，
   * 之后的重试全部堵在监听 backlog 里永远收不到数据）。因此仅在「adb 秒断（目标尚未
   * 监听）」时重试，连接建立后一直等到总超时或首块数据。
   * @throws server 进程退出、或 10s 内未开始推流时抛出
   */
  private async connectVideo(): Promise<void> {
    const deadline = Date.now() + 10000
    while (Date.now() < deadline) {
      if (this.process?.exitCode !== null && this.process?.exitCode !== undefined) throw new Error(this.describeFailure())
      // 首帧前的编码器初始化可能耗时数秒（华为 OMX 冷启动实测 >2s），不能用短超时放弃已建立的连接
      const settled = await Promise.race([
        this.tryConnect(),
        new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), deadline - Date.now()).unref())
      ])
      if (settled === 'timeout') {
        this.cleanupSocket()
        throw new Error(`投屏服务连接超时：${this.serverOutput.trim() || 'server 未开始推流'}`)
      }
      if (settled === 'refused') {
        // forward 目标尚未监听时 adb 会在几毫秒内断开本地连接，属预期内，稍后重试
        await new Promise((resolve) => setTimeout(resolve, 250))
        continue
      }
      return
    }
    throw new Error(`投屏服务连接超时：${this.serverOutput.trim() || 'server 未开始推流'}`)
  }

  /**
   * 尝试连接 video socket。
   * @returns 'refused' 表示目标尚未监听（可安全重试）；'connected' 表示首块数据已到达，
   * 常驻 data 监听已挂载。连接异常悬挂（既不断开也无数据）时不在此处判定，
   * 由 connectVideo 的总超时兜底。
   */
  private tryConnect(): Promise<'refused' | 'connected'> {
    return new Promise((resolve) => {
      const socket = net.connect({ host: '127.0.0.1', port: this.hostPort! })
      // 记录试探连接，总超时竞速获胜时由 connectVideo 销毁，避免悬置的 ESTABLISHED 泄漏
      this.probeSocket = socket
      const giveUp = (): void => {
        socket.removeAllListeners()
        socket.destroy()
        if (this.probeSocket === socket) this.probeSocket = null
        resolve('refused')
      }
      const onFirstData = (first: Buffer): void => {
        // 先摘掉试探期的 close/error 监听，避免常驻生命周期回调被 giveUp 语义误触发
        socket.removeListener('close', giveUp)
        socket.removeListener('error', giveUp)
        if (this.probeSocket === socket) this.probeSocket = null
        this.socket = socket
        this.onData(first)
        socket.on('data', (chunk: Buffer) => this.onData(chunk))
        socket.once('close', () => {
          this.cleanupSocket()
          this.onExit(this.stopping ? null : '投屏连接已断开，请重试')
        })
        socket.once('error', () => { /* close 会跟着触发 */ })
        resolve('connected')
      }
      socket.once('data', onFirstData)
      socket.once('close', giveUp)
      socket.once('error', giveUp)
    })
  }

  private cleanupSocket(): void {
    this.probeSocket?.destroy()
    this.probeSocket = null
    this.socket?.destroy()
    this.socket = null
  }

  /** 停止投屏并清理子进程与端口转发；设备已拔出时忽略清理错误。 */
  async stop(): Promise<void> {
    this.stopping = true
    this.cleanupSocket()
    this.process?.kill()
    this.process = null
    if (this.hostPort) {
      try { await adb(onDevice(this.serial, ['forward', '--remove', `tcp:${this.hostPort}`]), 3000) } catch { /* disconnected */ }
      this.hostPort = null
    }
  }
}
