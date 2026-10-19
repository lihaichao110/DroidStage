/**
 * H.264 Annex-B 切分器测试：帧边界识别、分片输入、AVCC 转换与参数集变化标记。
 * 注意切分器是流式的：一个访问单元在“下一个单元开始”时才结算产出。
 */
import { describe, expect, it } from 'vitest'
import { H264AnnexBDemuxer } from '../src/renderer/src/utils/h264'

/** 构造 NAL：首字节低 5 位为类型，其余为载荷。 */
function nal(type: number, payload: number[] = []): Uint8Array {
  return new Uint8Array([type & 0x1f, ...payload])
}

/** 常用 NAL：SPS 含 profile/constraint/level 三字节（供 codec 串推导）。 */
const SPS = nal(7, [0x64, 0x00, 0x34, 0x0a])
const SPS_ALT = nal(7, [0x4d, 0x00, 0x19, 0x0a])
const PPS = nal(8, [0xee])
const IDR = nal(5, [0x11, 0x22])
const P_SLICE = nal(1, [0x33])

/** 用起始码拼接 NAL 序列，构成 Annex-B 流片段。 */
function annexb(...units: Uint8Array[]): Uint8Array {
  const parts: Uint8Array[] = units.map((unit) => new Uint8Array([0, 0, 1, ...unit]))
  const size = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(size)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

/** 把字节流按固定大小切块，模拟 socket 分片送达。 */
function chunked(bytes: Uint8Array, size: number): Uint8Array[] {
  const chunks: Uint8Array[] = []
  for (let offset = 0; offset < bytes.length; offset += size) chunks.push(bytes.slice(offset, offset + size))
  return chunks
}

describe('H264AnnexBDemuxer', () => {
  it('关键帧：SPS/PPS 归入同帧并携带 description 与 codec 串', () => {
    const demuxer = new H264AnnexBDemuxer()
    // 流式切分只结算"确认结束"的帧：末尾再补一个切片，前一个切片到达即结束 IDR 帧
    const frames = demuxer.feed(annexb(SPS, PPS, IDR, P_SLICE, nal(1, [0x44])))
    expect(frames).toHaveLength(1)
    const frame = frames[0]
    expect(frame.keyframe).toBe(true)
    // avc1.<profile><constraint><level>，SPS 头三字节 64 00 34
    expect(frame.codec).toBe('avc1.640034')
    // avcC：record 头 + 长度前缀的 SPS/PPS
    expect(frame.description).toBeDefined()
    expect(Array.from(frame.description!.slice(0, 8))).toEqual([1, 0x64, 0x00, 0x34, 0xff, 0xe1, 0, SPS.length])
    // AVCC 数据：每个 NAL 前 4 字节大端长度
    expect(Array.from(frame.data.slice(0, 4))).toEqual([0, 0, 0, SPS.length])
  })

  it('分片输入：起始码与 NAL 跨任意块边界都能正确切分', () => {
    const stream = annexb(SPS, PPS, IDR, P_SLICE, nal(1, [0x44]), SPS, PPS, IDR)
    const demuxer = new H264AnnexBDemuxer()
    const collected: number[] = []
    // 2/3 字节小块交替，覆盖起始码被任意切断的情况
    let size = 2
    for (const chunk of chunked(stream, size)) {
      collected.push(...demuxer.feed(chunk).map((frame) => frame.data.length))
      size = size === 2 ? 3 : 2
    }
    // 收尾补两个切片：倒数第二个到达时结算最后一个 IDR 帧；共 4 个访问单元
    collected.push(...demuxer.feed(annexb(P_SLICE, P_SLICE)).map((frame) => frame.data.length))
    expect(collected).toHaveLength(4)
    expect(collected.every((length) => length > 0)).toBe(true)
  })

  it('连续切片分帧：新切片到达时结算上一帧', () => {
    const demuxer = new H264AnnexBDemuxer()
    const first = demuxer.feed(annexb(SPS, PPS, IDR, P_SLICE, nal(1, [0x44])))
    // IDR 帧在下一个切片到达时立即产出，末尾切片保持悬置
    expect(first).toHaveLength(1)
    expect(first[0].keyframe).toBe(true)
    // 两次 feed 的悬置切片先后结算，均为 delta 帧
    const second = demuxer.feed(annexb(P_SLICE, P_SLICE))
    expect(second).toHaveLength(2)
    expect(second.every((frame) => !frame.keyframe && frame.description === undefined)).toBe(true)
  })

  it('SPS 变化（如旋转重置编码器）时随新关键帧重新携带 description', () => {
    const demuxer = new H264AnnexBDemuxer()
    demuxer.feed(annexb(SPS, PPS, IDR))
    const next = demuxer.feed(annexb(SPS_ALT, PPS, IDR, P_SLICE, P_SLICE))
    // 新 SPS 先结算旧 IDR 帧（携带旧参数集），新关键帧携带新参数集
    expect(next).toHaveLength(2)
    expect(next[0].codec).toBe('avc1.640034')
    expect(next[1].codec).toBe('avc1.4d0019')
    expect(next[1].description).toBeDefined()
  })

  it('参数集未变化时重复发送不触发 description（避免无谓 reconfigure）', () => {
    const demuxer = new H264AnnexBDemuxer()
    demuxer.feed(annexb(SPS, PPS, IDR, P_SLICE, P_SLICE))
    const second = demuxer.feed(annexb(SPS, PPS, IDR, P_SLICE, P_SLICE))
    // 先结算上一批遗留的 P 帧，再是新 IDR 帧（SPS 会把悬置切片单独结算，故多一帧）
    expect(second).toHaveLength(3)
    expect(second[2].keyframe).toBe(true)
    expect(second[2].description).toBeUndefined()
  })

  it('忽略首个起始码之前的残留字节', () => {
    const demuxer = new H264AnnexBDemuxer()
    const garbage = new Uint8Array([0xff, 0xee, 0x00, 0x13])
    const frames = demuxer.feed(new Uint8Array([...garbage, ...annexb(SPS, PPS, IDR, P_SLICE, P_SLICE)]))
    expect(frames).toHaveLength(1)
  })

  it('超限仍无起始码时抛出数据流异常', () => {
    const demuxer = new H264AnnexBDemuxer()
    expect(() => demuxer.feed(new Uint8Array(5 * 1024 * 1024))).toThrow('数据流异常')
  })
})
