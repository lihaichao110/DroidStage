/**
 * 视频解码管线测试：看门狗三种断点文案、解码器配置、队列超限丢帧策略与软解回退。
 * 解码器与编码帧均注入 mock，不依赖真实 WebCodecs。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VideoPipeline, type DecoderLike } from '../src/renderer/src/utils/video-pipeline'

/** 构造 NAL：首字节低 5 位为类型，其余为载荷。 */
function nal(type: number, payload: number[] = []): Uint8Array {
  return new Uint8Array([type & 0x1f, ...payload])
}

// SPS 含 profile/constraint/level 三字节，供 codec 串推导；P_SLICE 兼作帧边界触发器
const SPS = nal(7, [0x64, 0x00, 0x34, 0x0a])
const PPS = nal(8, [0xee])
const IDR = nal(5, [0x11])
const P_SLICE = nal(1, [0x33])

/** 用起始码拼接 NAL 序列，构成 Annex-B 流片段。 */
function annexb(...units: Uint8Array[]): Uint8Array {
  const parts: Uint8Array[] = units.map((unit) => new Uint8Array([0, 0, 1, ...unit]))
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

/** 假解码器：记录 configure/decode 调用，输出与错误由测试手动触发。 */
class FakeDecoder implements DecoderLike {
  configs: VideoDecoderConfig[] = []
  chunks: { type: 'key' | 'delta'; timestamp: number }[] = []
  queueSize = 0
  closed = false
  constructor(
    private readonly output: (frame: VideoFrame) => void,
    public readonly fail: (message: string) => void
  ) {}
  get decodeQueueSize(): number { return this.queueSize }
  configure(config: VideoDecoderConfig): void { this.configs.push(config) }
  decode(chunk: EncodedVideoChunk): void {
    this.chunks.push(chunk as unknown as { type: 'key' | 'delta'; timestamp: number })
    this.output({ close: () => {} } as unknown as VideoFrame)
  }
  close(): void { this.closed = true }
}

type Harness = {
  pipeline: VideoPipeline
  frames: VideoFrame[]
  errors: string[]
  decoders: FakeDecoder[]
}

/** 建立注入 mock 的管线；decodeOutput=false 时解码器不自动产出帧。 */
function createHarness(decodeOutput = true): Harness {
  const frames: VideoFrame[] = []
  const errors: string[] = []
  const decoders: FakeDecoder[] = []
  const pipeline = new VideoPipeline(
    { onFrame: (frame) => frames.push(frame), onError: (message) => errors.push(message) },
    {
      createDecoder: (output, error) => {
        const decoder = new FakeDecoder(
          decodeOutput ? output : () => {},
          (message) => error(new DOMException(message))
        )
        decoders.push(decoder)
        return decoder
      },
      createChunk: (init) => init as unknown as EncodedVideoChunk
    }
  )
  return { pipeline, frames, errors, decoders }
}

describe('VideoPipeline', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('正常流：创建解码器、配置 description、按 key/delta 送解并回调输出', () => {
    const harness = createHarness()
    // 末尾多补一个切片：流式切分只在「下一单元到达」时结算上一帧
    harness.pipeline.feed(annexb(SPS, PPS, IDR, P_SLICE, P_SLICE, P_SLICE))
    expect(harness.decoders).toHaveLength(1)
    const config = harness.decoders[0].configs[0]
    expect(config.codec).toBe('avc1.640034')
    expect(config.description).toBeDefined()
    expect(config.optimizeForLatency).toBe(true)
    expect(harness.decoders[0].chunks.map((chunk) => chunk.type)).toEqual(['key', 'delta'])
    // 首帧解码成功后取消看门狗：超时时限过后不应报错
    vi.advanceTimersByTime(10_000)
    expect(harness.errors).toEqual([])
    harness.pipeline.dispose()
    expect(harness.decoders[0].closed).toBe(true)
  })

  it('看门狗：端口建立后未收到任何数据时报「未收到视频数据」', () => {
    const harness = createHarness()
    vi.advanceTimersByTime(8000)
    expect(harness.errors).toHaveLength(1)
    expect(harness.errors[0]).toContain('未收到任何视频数据')
  })

  it('看门狗：收到数据但解析不出 H.264 帧时报格式异常并带字节数', () => {
    const harness = createHarness()
    harness.pipeline.feed(new Uint8Array([1, 2, 3, 4, 5]))
    vi.advanceTimersByTime(8000)
    expect(harness.errors).toHaveLength(1)
    expect(harness.errors[0]).toContain('未解析出 H.264 帧')
    expect(harness.errors[0]).toContain('5 字节')
  })

  it('看门狗：帧已解析但解码器无输出时报解码异常', () => {
    const harness = createHarness(false)
    harness.pipeline.feed(annexb(SPS, PPS, IDR, P_SLICE, P_SLICE))
    expect(harness.pipeline.frames).toBeGreaterThan(0)
    vi.advanceTimersByTime(8000)
    expect(harness.errors).toHaveLength(1)
    expect(harness.errors[0]).toContain('解码器无输出')
  })

  it('队列超限：丢弃全部帧等待关键帧，队列恢复后从下一个关键帧续播', () => {
    const harness = createHarness()
    harness.pipeline.feed(annexb(SPS, PPS, IDR, P_SLICE, P_SLICE))
    expect(harness.pipeline.decoded).toBe(1)
    const decoder = harness.decoders[0]
    decoder.queueSize = 200
    // 队列积压期间：关键帧与 delta 帧全部丢弃（已解码数保持不动）
    harness.pipeline.feed(annexb(IDR, P_SLICE, P_SLICE, IDR, P_SLICE))
    expect(harness.pipeline.decoded).toBe(1)
    // 队列恢复：先解码积压期间排队的关键帧与随后的 delta（参考链完整），再续 key/delta
    decoder.queueSize = 0
    harness.pipeline.feed(annexb(SPS, PPS, IDR, P_SLICE, P_SLICE))
    harness.pipeline.feed(annexb(P_SLICE))
    expect(decoder.chunks.map((chunk) => chunk.type)).toEqual(['key', 'key', 'delta', 'key', 'delta'])
  })

  it('解码报错：自动回退软件解码并在下一个关键帧重建，再失败才报错', () => {
    const harness = createHarness(false)
    harness.pipeline.feed(annexb(SPS, PPS, IDR, P_SLICE, P_SLICE))
    expect(harness.decoders).toHaveLength(1)
    harness.decoders[0].fail('硬件解码异常')
    // 回退期间 delta 帧被丢弃，不影响错误上报
    harness.pipeline.feed(annexb(P_SLICE, P_SLICE))
    expect(harness.errors).toEqual([])
    // 同一参数集的关键帧到来：以软解偏好重建解码器
    harness.pipeline.feed(annexb(SPS, PPS, IDR, P_SLICE, P_SLICE))
    expect(harness.decoders).toHaveLength(2)
    expect(harness.decoders[1].configs[0].hardwareAcceleration).toBe('prefer-software')
    // 软解仍失败：判定不可恢复并上报
    harness.decoders[1].fail('软件解码异常')
    expect(harness.errors).toHaveLength(1)
    expect(harness.errors[0]).toContain('视频解码失败')
  })

  it('dispose 后不再产生任何输出', () => {
    const harness = createHarness()
    harness.pipeline.dispose()
    harness.pipeline.feed(annexb(SPS, PPS, IDR, P_SLICE, P_SLICE))
    vi.advanceTimersByTime(10_000)
    expect(harness.decoders).toHaveLength(0)
    expect(harness.frames).toHaveLength(0)
    expect(harness.errors).toEqual([])
  })
})
