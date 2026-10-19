/**
 * H.264 Annex-B 流解析（纯逻辑，不依赖 DOM）：把投屏 socket 送来的连续字节增量切分为
 * NAL 单元并聚合成完整帧，转成 WebCodecs 需要的 AVCC 格式（4 字节长度前缀），
 * 同时提取 SPS/PPS 组装 avcC description 与 codec 串。参数集变化（如旋转导致编码器
 * 重置）时随下一个关键帧携带新 description，上层据此重新 configure 解码器。
 */

export type H264Frame = {
  /** AVCC 数据：每个 NAL 前置 4 字节大端长度，可直接作为 EncodedVideoChunk 的 data。 */
  data: Uint8Array
  /** 是否包含 IDR 切片（关键帧）。 */
  keyframe: boolean
  /** avcC 记录（SPS+PPS），仅在参数集更新后的首个帧携带，用于解码器 (re)configure。 */
  description?: Uint8Array
  /** 由 SPS 头三字节推导的 codec 串（avc1.PPCCLL），与 description 同时携带。 */
  codec?: string
}

// NAL 单元类型（H.264 规范 表7-1），这里只用到与帧边界相关的几种
const NAL_IDR = 5
const NAL_SPS = 7
const NAL_PPS = 8
const NAL_AUD = 9

/** 单次 feed 的输入与残留缓冲上限：有效流中起始码间隔远小于该值，超限说明输入不是 H.264。 */
const MAX_BUFFER = 4 * 1024 * 1024

export class H264AnnexBDemuxer {
  // 显式标注泛型：字段推断会收窄成 Uint8Array<ArrayBuffer>，与入参的默认泛型不兼容
  private carry: Uint8Array = new Uint8Array(0)
  private nals: Uint8Array[] = []
  private hasVcl = false
  private keyframe = false
  private sps: Uint8Array | null = null
  private pps: Uint8Array | null = null
  private configDirty = false

  /**
   * 送入一段原始字节，返回其间凑齐的所有完整帧（0 到多帧）。
   * 支持起始码与帧数据跨调用任意分片。
   * @throws 输入超限仍找不到起始码时抛出（数据流异常）
   */
  feed(input: Uint8Array): H264Frame[] {
    if (this.carry.length) {
      const merged = new Uint8Array(this.carry.length + input.length)
      merged.set(this.carry)
      merged.set(input, this.carry.length)
      input = merged
    }
    if (input.length > MAX_BUFFER) throw new Error('投屏数据流异常：未能解析出 H.264 帧')
    const codes = findStartCodes(input)
    if (codes.length === 0) {
      this.carry = input
      return []
    }
    const frames: H264Frame[] = []
    // 相邻起始码之间即一个完整 NAL；首个起始码之前的残余字节（正常流不存在）直接丢弃
    for (let index = 0; index + 1 < codes.length; index++) {
      const start = codes[index] + 3
      const end = codes[index + 1]
      if (end > start) this.pushNal(input.subarray(start, end), frames)
    }
    // 末尾起始码之后的 NAL 尚不完整，连同起始码保留到下次拼接（也覆盖起始码跨包分片）
    this.carry = input.slice(codes[codes.length - 1])
    return frames
  }

  /** 按类型归并 NAL：非 VCL NAL 附加到当前帧，VCL 开新帧，参数集变化置脏标记。 */
  private pushNal(nal: Uint8Array, frames: H264Frame[]): void {
    const type = nal[0] & 0x1f
    if (type === NAL_SPS) {
      if (nal.length < 4) return
      // SPS 属于下一个访问单元：先结算上一帧，参数集变化标记跟随新帧下发
      this.flush(frames)
      if (!this.sps || !bytesEqual(this.sps, nal)) this.configDirty = true
      this.sps = nal.slice()
      this.nals.push(nal)
      return
    }
    if (type === NAL_PPS) {
      if (!this.pps || !bytesEqual(this.pps, nal)) this.configDirty = true
      this.pps = nal.slice()
      this.nals.push(nal)
      return
    }
    if (type === NAL_AUD) {
      // AUD 显式标记访问单元边界
      this.flush(frames)
      this.nals.push(nal)
      return
    }
    if (type >= 1 && type <= NAL_IDR) {
      // 已有切片再遇切片说明进入新帧
      if (this.hasVcl) this.flush(frames)
      this.hasVcl = true
      if (type === NAL_IDR) this.keyframe = true
      this.nals.push(nal)
      return
    }
    // SEI 等其余类型：附加到当前帧
    this.nals.push(nal)
  }

  /** 把已积累的 NAL 结算为一帧；参数集有变化时附带 description 与 codec。 */
  private flush(frames: H264Frame[]): void {
    if (!this.nals.length || !this.hasVcl) {
      this.nals = []
      this.hasVcl = false
      this.keyframe = false
      return
    }
    const frame: H264Frame = { data: toAvcc(this.nals), keyframe: this.keyframe }
    if (this.configDirty && this.sps && this.pps) {
      frame.description = buildAvcC(this.sps, this.pps)
      frame.codec = codecFromSps(this.sps)
      this.configDirty = false
    }
    frames.push(frame)
    this.nals = []
    this.hasVcl = false
    this.keyframe = false
  }
}

/** 找出全部 00 00 01 起始码的匹配位置；4 字节起始码（多一个前导 0）会自然命中在其末 3 字节。 */
function findStartCodes(bytes: Uint8Array): number[] {
  const codes: number[] = []
  for (let index = 0; index + 2 < bytes.length; index++) {
    if (bytes[index] === 0 && bytes[index + 1] === 0 && bytes[index + 2] === 1) codes.push(index)
  }
  return codes
}

/** NAL 列表转 AVCC：每个 NAL 前写 4 字节大端长度。 */
function toAvcc(nals: Uint8Array[]): Uint8Array {
  let size = 0
  for (const nal of nals) size += nal.length + 4
  const out = new Uint8Array(size)
  const view = new DataView(out.buffer)
  let offset = 0
  for (const nal of nals) {
    view.setUint32(offset, nal.length)
    out.set(nal, offset + 4)
    offset += nal.length + 4
  }
  return out
}

/** 组装 AVCDecoderConfigurationRecord（avcC）：WebCodecs configure 的 description。 */
function buildAvcC(sps: Uint8Array, pps: Uint8Array): Uint8Array {
  const out = new Uint8Array(11 + sps.length + pps.length)
  const view = new DataView(out.buffer)
  out[0] = 1
  out[1] = sps[1]
  out[2] = sps[2]
  out[3] = sps[3]
  out[4] = 0xff // lengthSizeMinusOne = 3（4 字节长度前缀）
  out[5] = 0xe1 // numOfSequenceParameterSets = 1
  view.setUint16(6, sps.length)
  out.set(sps, 8)
  out[8 + sps.length] = 1 // numOfPictureParameterSets = 1
  view.setUint16(9 + sps.length, pps.length)
  out.set(pps, 11 + sps.length)
  return out
}

/** 从 SPS 头推导 codec 串：avc1.<profile><constraint><level>（各 1 字节十六进制）。 */
function codecFromSps(sps: Uint8Array): string {
  const hex = (value: number): string => value.toString(16).padStart(2, '0')
  return `avc1.${hex(sps[1])}${hex(sps[2])}${hex(sps[3])}`
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let index = 0; index < a.length; index++) {
    if (a[index] !== b[index]) return false
  }
  return true
}
