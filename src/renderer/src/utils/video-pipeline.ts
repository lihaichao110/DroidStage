/**
 * 视频解码管线：封装 H.264 切分、WebCodecs 解码与首帧看门狗。
 * 所有静默失败路径（数据未送达、解析不出帧、解码无输出）都会在看门狗时限内
 * 转化为带计数器的明确错误，避免「已连接但黑屏且无任何提示」。
 */
import { H264AnnexBDemuxer, type H264Frame } from './h264'

/** 解码队列积压上限：超过说明解码跟不上推流，进入等待关键帧模式（丢 delta 保参考链完整）。 */
const MAX_DECODE_QUEUE = 120
/** 端口建立后首帧解码成功的时限，超时按计数器定位断点并报错。 */
const FIRST_FRAME_TIMEOUT_MS = 8000

/** 解码器最小接口：真实环境为 WebCodecs VideoDecoder，测试注入 mock。 */
export type DecoderLike = {
  configure(config: VideoDecoderConfig): void
  decode(chunk: EncodedVideoChunk): void
  readonly decodeQueueSize: number
  close(): void
}

export type PipelineOptions = {
  /** 创建解码器；默认使用浏览器 WebCodecs，测试注入 mock。 */
  createDecoder?: (output: (frame: VideoFrame) => void, error: (error: DOMException) => void) => DecoderLike
  /** 构造编码帧；默认使用浏览器 EncodedVideoChunk，测试注入 mock。 */
  createChunk?: (init: EncodedVideoChunkInit) => EncodedVideoChunk
}

export type PipelineEvents = {
  /** 解码输出（调用方负责绘制与 frame.close）。 */
  onFrame: (frame: VideoFrame) => void
  /** 不可恢复错误（含看门狗超时），文案自带定位信息。 */
  onError: (message: string) => void
}

export class VideoPipeline {
  bytes = 0
  frames = 0
  decoded = 0
  private readonly demuxer = new H264AnnexBDemuxer()
  private decoder: DecoderLike | null = null
  /** 最近一次参数集（codec + avcC）：解码器重建（软解回退）时用存量配置立即重配。 */
  private config: { codec: string; description: Uint8Array } | null = null
  /** 解码器加速偏好：默认跟随浏览器，仅在硬解报错后显式回退软解。 */
  private hardwareAcceleration: HardwareAcceleration | null = null
  private triedSoftware = false
  /** 队列超限或解码器重建后置位：丢弃 delta 帧，等下一个关键帧恢复。 */
  private awaitingKeyframe = false
  private timestamp = 0
  private watchdog: ReturnType<typeof setTimeout> | null
  private dead = false

  constructor(private readonly events: PipelineEvents, options: PipelineOptions = {}) {
    this.createDecoder = options.createDecoder ?? ((output, error) => new VideoDecoder({ output, error }))
    this.createChunk = options.createChunk ?? ((init) => new EncodedVideoChunk(init))
    this.watchdog = null
    // WebCodecs 不存在（异常精简的运行环境）时立即明确报错，而不是等看门狗
    if (!options.createDecoder && typeof VideoDecoder === 'undefined') {
      this.dead = true
      this.fail('当前环境不支持 WebCodecs 视频解码，无法显示投屏画面')
      return
    }
    this.watchdog = setTimeout(() => this.onWatchdog(), FIRST_FRAME_TIMEOUT_MS)
  }

  private readonly createDecoder: (output: (frame: VideoFrame) => void, error: (error: DOMException) => void) => DecoderLike
  private readonly createChunk: (init: EncodedVideoChunkInit) => EncodedVideoChunk

  /** 送入一段视频字节流（Annex-B H.264），内部完成切分与解码。 */
  feed(input: Uint8Array): void {
    if (this.dead) return
    try {
      this.bytes += input.length
      for (const frame of this.demuxer.feed(input)) {
        this.frames += 1
        this.decodeFrame(frame)
      }
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error))
    }
  }

  /** 释放解码器与看门狗（断开/换流/卸载时调用），不触发错误回调。 */
  dispose(): void {
    this.dead = true
    if (this.watchdog !== null) clearTimeout(this.watchdog)
    this.watchdog = null
    this.decoder?.close()
    this.decoder = null
  }

  private decodeFrame(frame: H264Frame): void {
    if (frame.description && frame.codec) {
      this.config = { codec: frame.codec, description: frame.description }
      // 参数集变化（旋转等）时对现役解码器重配
      this.decoder?.configure(this.buildConfig())
    }
    if (!this.decoder) {
      // 参数集未到（流起点被截断等）：静默丢弃，由看门狗兜底报错
      if (!this.config) return
      this.decoder = this.createDecoder(
        (frameOut) => {
          this.decoded += 1
          if (this.watchdog !== null) {
            clearTimeout(this.watchdog)
            this.watchdog = null
          }
          this.events.onFrame(frameOut)
        },
        (error) => this.onDecoderError(error)
      )
      this.decoder.configure(this.buildConfig())
    }
    if (this.awaitingKeyframe) {
      // 关键帧到来即恢复送解；此前到达的 delta 帧参考链不完整，直接丢弃
      if (!frame.keyframe) return
      this.awaitingKeyframe = false
    }
    if (this.decoder.decodeQueueSize > MAX_DECODE_QUEUE) {
      this.awaitingKeyframe = true
      return
    }
    // 时间戳只需单调递增（微秒），渲染按到达顺序即时绘制，不做 PTS 对齐
    this.timestamp += 1000
    this.decoder.decode(this.createChunk({ type: frame.keyframe ? 'key' : 'delta', timestamp: this.timestamp, data: frame.data }))
  }

  /**
   * 解码器报错：个别显卡驱动对硬解支持不佳，先自动回退软件解码并等下一个关键帧重建；
   * 软解仍失败才判定为不可恢复。
   */
  private onDecoderError(error: DOMException): void {
    if (this.dead) return
    this.decoder?.close()
    this.decoder = null
    if (!this.triedSoftware) {
      this.triedSoftware = true
      this.hardwareAcceleration = 'prefer-software'
      this.awaitingKeyframe = true
      return
    }
    this.fail(`视频解码失败：${error.message}`)
  }

  private buildConfig(): VideoDecoderConfig {
    const config: VideoDecoderConfig = { codec: this.config!.codec, description: this.config!.description, optimizeForLatency: true }
    if (this.hardwareAcceleration) config.hardwareAcceleration = this.hardwareAcceleration
    return config
  }

  /** 首帧看门狗：按计数器区分「数据未送达 / 解析不出帧 / 解码无输出」三种断点。 */
  private onWatchdog(): void {
    if (this.dead) return
    if (this.decoded > 0) return
    if (this.bytes === 0) {
      this.fail(`投屏异常：${FIRST_FRAME_TIMEOUT_MS / 1000} 秒内未收到任何视频数据，请点击重新投屏`)
    } else if (this.frames === 0) {
      this.fail(`投屏异常：已接收 ${this.bytes} 字节但未解析出 H.264 帧，视频流格式异常`)
    } else {
      this.fail(`投屏异常：已解析 ${this.frames} 帧但解码器无输出（硬件解码可能异常），请点击重新投屏`)
    }
  }

  private fail(message: string): void {
    this.dispose()
    this.events.onError(message)
  }
}
