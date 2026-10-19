/**
 * platform-tools 下载源的纯函数推导：镜像 URL、压缩包名、解压命令。
 * 纯逻辑下沉到 shared 便于 Vitest 覆盖，实际下载与解压的 IO 在 src/main/adb-provision.ts。
 */
import path from 'node:path'

/** 依次尝试的下载镜像：国内腾讯镜像优先，Google 官方源兜底（国内网络通常无法直连） */
const MIRRORS = ['https://mirrors.cloud.tencent.com/AndroidSDK', 'https://dl.google.com/android/repository'] as const

/**
 * 判断平台是否支持自动下载 platform-tools。
 * @param platform Node 的 process.platform 值
 * @returns 项目发行仅面向 Windows/macOS，其余平台返回 false
 */
export function isDownloadPlatform(platform: NodeJS.Platform): boolean {
  return platform === 'win32' || platform === 'darwin'
}

/**
 * 按平台推导 platform-tools 压缩包名。
 * @param platform Node 的 process.platform 值
 * @returns 官方 latest 端点的压缩包文件名
 */
export function platformToolsZipName(platform: NodeJS.Platform): string {
  if (platform === 'win32') return 'platform-tools-latest-windows.zip'
  if (platform === 'darwin') return 'platform-tools-latest-darwin.zip'
  return 'platform-tools-latest-linux.zip'
}

/**
 * 生成按序尝试的镜像下载 URL 列表。
 * @param zipName platformToolsZipName 的结果
 * @returns 镜像 URL 数组，全部失败才算下载失败
 */
export function platformToolsUrls(zipName: string): string[] {
  return MIRRORS.map((mirror) => `${mirror}/${zipName}`)
}

/**
 * 官方 zip 解压后 adb 相对于缓存目录的路径（压缩包内固定含一层 platform-tools 目录）。
 * @param platform Node 的 process.platform 值
 * @returns 相对路径，win32 带 .exe 后缀
 */
export function adbRelativePath(platform: NodeJS.Platform): string {
  return path.join('platform-tools', platform === 'win32' ? 'adb.exe' : 'adb')
}

/**
 * 构造系统自带工具的 zip 解压命令，避免为一次性解压引入第三方依赖。
 * Windows 10 1803+ 内置 bsdtar（System32\tar.exe）可直接解 zip；用绝对路径锁定它，
 * 防止 PATH 里 Git 自带的 GNU tar 抢先（GNU tar 不识别 zip 格式）。路径统一转正斜杠兼容 bsdtar。
 * @param platform Node 的 process.platform 值
 * @param zipPath 压缩包绝对路径
 * @param destDir 解压目标目录
 */
export function extractCommand(
  platform: NodeJS.Platform,
  zipPath: string,
  destDir: string
): { file: string; args: string[] } {
  const normalizedZip = zipPath.split(path.sep).join('/')
  const normalizedDir = destDir.split(path.sep).join('/')
  if (platform === 'win32') {
    const tar = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
    return { file: tar, args: ['-xf', normalizedZip, '-C', normalizedDir] }
  }
  return { file: 'unzip', args: ['-o', normalizedZip, '-d', normalizedDir] }
}
