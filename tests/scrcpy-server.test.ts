/**
 * scrcpy-server 启动参数测试：参数完整性、scid 进制约定，以及版本常量与入库二进制清单的一致性
 * （scrcpy 协议无版本兼容承诺，server 会逐字符比对客户端版本号）。
 */
import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '' } }))

const { buildServerArgs, SCRCPY_VERSION, DEFAULT_SCRCPY_OPTIONS } = await import('../src/main/scrcpy-server')

describe('buildServerArgs', () => {
  it('包含视频+控制双通道的全部关键参数', () => {
    const args = buildServerArgs(1, DEFAULT_SCRCPY_OPTIONS)
    for (const required of [
      'tunnel_forward=true',
      'video=true',
      'audio=false',
      'video_codec=h264',
      'control=true',
      'raw_stream=true',
      'stay_awake=true',
      `max_size=${DEFAULT_SCRCPY_OPTIONS.maxSize}`,
      `video_bit_rate=${DEFAULT_SCRCPY_OPTIONS.bitRate}`,
      `max_fps=${DEFAULT_SCRCPY_OPTIONS.maxFps}`
    ]) {
      expect(args).toContain(required)
    }
  })

  it('scid 以 16 进制传递（server 端按 %08x 拼 socket 名）', () => {
    expect(buildServerArgs(0x3f2a1, DEFAULT_SCRCPY_OPTIONS)[0]).toBe('scid=3f2a1')
  })

  it('版本常量与 assets/mirroring 清单一致', async () => {
    const manifest = JSON.parse(await readFile(new URL('../assets/mirroring/manifest.json', import.meta.url), 'utf8')) as { version: string }
    expect(SCRCPY_VERSION).toBe(manifest.version)
  })
})
