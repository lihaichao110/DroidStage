/**
 * ADB 下载源纯函数测试：镜像顺序、平台映射与解压命令构造。
 */
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { adbRelativePath, extractCommand, isDownloadPlatform, platformToolsUrls, platformToolsZipName } from '../src/shared/utils/adb-source'

describe('isDownloadPlatform', () => {
  it('仅 Windows/macOS 支持自动下载', () => {
    expect(isDownloadPlatform('win32')).toBe(true)
    expect(isDownloadPlatform('darwin')).toBe(true)
    expect(isDownloadPlatform('linux')).toBe(false)
  })
})

describe('platformToolsZipName', () => {
  it('按平台映射官方压缩包名', () => {
    expect(platformToolsZipName('win32')).toBe('platform-tools-latest-windows.zip')
    expect(platformToolsZipName('darwin')).toBe('platform-tools-latest-darwin.zip')
    expect(platformToolsZipName('linux')).toBe('platform-tools-latest-linux.zip')
  })
})

describe('platformToolsUrls', () => {
  it('国内镜像优先、Google 官方源兜底', () => {
    const urls = platformToolsUrls('platform-tools-latest-windows.zip')
    expect(urls).toHaveLength(2)
    expect(urls[0]).toContain('mirrors.cloud.tencent.com')
    expect(urls[1]).toContain('dl.google.com')
    expect(urls.every((url) => url.endsWith('/platform-tools-latest-windows.zip'))).toBe(true)
  })
})

describe('adbRelativePath', () => {
  it('win32 指向 adb.exe，其余平台无后缀', () => {
    expect(adbRelativePath('win32')).toBe(path.join('platform-tools', 'adb.exe'))
    expect(adbRelativePath('darwin')).toBe(path.join('platform-tools', 'adb'))
  })
})

describe('extractCommand', () => {
  it('win32 锁定 System32 的 bsdtar 且路径转正斜杠', () => {
    const { file, args } = extractCommand('win32', 'C:\\cache\\x.zip', 'C:\\cache')
    expect(file).toBe(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'))
    expect(args).toEqual(['-xf', 'C:/cache/x.zip', '-C', 'C:/cache'])
  })

  it('darwin 使用系统 unzip', () => {
    const { file, args } = extractCommand('darwin', '/tmp/x.zip', '/tmp/out')
    expect(file).toBe('unzip')
    expect(args).toEqual(['-o', '/tmp/x.zip', '-d', '/tmp/out'])
  })
})
