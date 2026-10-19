/**
 * ADB 二进制供给：开发模式在 assets 未登记时自动下载官方 platform-tools 到 userData 缓存，
 * 免去手工配置；打包发行只认自构建产物（AGENTS.md 硬性约束），绝不联网下载。
 */
import { app } from 'electron'
import { spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { adbRelativePath, extractCommand, isDownloadPlatform, platformToolsUrls, platformToolsZipName } from '../shared/utils/adb-source'

const DOWNLOAD_TIMEOUT_MS = 120_000 // 压缩包约 6~13MB，慢速网络下留足余量
const EXTRACT_TIMEOUT_MS = 60_000

let cachedPath: string | null = null
let pending: Promise<string> | null = null

/**
 * 解析可用的 adb 可执行文件路径，缓存未命中时自动下载。
 * 优先级：ADB_PATH 环境变量 > assets 自构建产物 > userData 缓存（自动下载）。
 * @returns adb 可执行文件的绝对路径
 * @throws 打包构建缺组件、所有镜像下载失败或平台不支持自动下载时抛出
 */
export function ensureAdb(): Promise<string> {
  if (cachedPath) return Promise.resolve(cachedPath)
  // 设备列表会被 UI 并发刷新，单飞保证同一时刻只触发一次下载，其余调用等待复用同一结果
  pending ??= resolveAdb().then(
    (resolved) => {
      cachedPath = resolved
      pending = null
      return resolved
    },
    (error) => {
      // 失败后清空以便网络恢复后可重试
      pending = null
      throw error
    }
  )
  return pending
}

async function resolveAdb(): Promise<string> {
  if (!app.isPackaged && process.env.ADB_PATH) {
    if (!existsSync(process.env.ADB_PATH)) throw new Error(`开发用 ADB 路径无效：${process.env.ADB_PATH}`)
    return process.env.ADB_PATH
  }
  const target = process.platform === 'win32' ? 'win32/adb.exe' : process.arch === 'arm64' ? 'darwin-arm64/adb' : 'darwin-x64/adb'
  const root = app.isPackaged ? path.join(process.resourcesPath, 'adb') : path.join(app.getAppPath(), 'assets', 'adb')
  const staged = path.join(root, target)
  if (existsSync(staged)) return staged
  if (app.isPackaged) throw new Error(`安装包缺少 ADB 组件：${target}。此构建不能连接手机。`)
  const cached = path.join(cacheDir(), adbRelativePath(process.platform))
  if (existsSync(cached)) return cached
  return downloadPlatformTools(cached)
}

function cacheDir(): string {
  return path.join(app.getPath('userData'), 'adb-cache')
}

async function downloadPlatformTools(expectedBinary: string): Promise<string> {
  if (!isDownloadPlatform(process.platform)) {
    throw new Error('当前开发平台不支持自动下载 ADB，请设置 ADB_PATH 环境变量指向本机 adb')
  }
  const dir = cacheDir()
  const zipName = platformToolsZipName(process.platform)
  const zipPath = path.join(dir, zipName)
  const failures: string[] = []
  for (const url of platformToolsUrls(zipName)) {
    try {
      mkdirSync(dir, { recursive: true })
      await fetchZip(url, zipPath)
      await extractZip(zipPath, dir)
      // 官方 zip 通常保留可执行位，统一切到 755 兜底镜像源权限丢失的情况（Windows 无此概念）
      if (process.platform !== 'win32') chmodSync(expectedBinary, 0o755)
      if (!existsSync(expectedBinary)) throw new Error('解压结果中缺少 adb 可执行文件')
      // 登记来源与时间便于排查；官方 latest 端点不提供校验和，故不做哈希校验
      await writeFile(path.join(dir, 'source.json'), JSON.stringify({ url, downloadedAt: new Date().toISOString() }, null, 2) + '\n')
      return expectedBinary
    } catch (error) {
      // 清理半成品，避免残缺的 zip 或目录让下次误判为可用缓存
      rmSync(zipPath, { force: true })
      rmSync(path.join(dir, 'platform-tools'), { recursive: true, force: true })
      failures.push(`${new URL(url).host}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  throw new Error(`ADB 自动下载失败（${failures.join('；')}）。请检查网络，或设置 ADB_PATH 指向本机 adb 后重试`)
}

async function fetchZip(url: string, zipPath: string): Promise<void> {
  const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  // 压缩包最大约 13MB，整体载入内存可接受，换取实现简单
  await writeFile(zipPath, Buffer.from(await response.arrayBuffer()))
}

async function extractZip(zipPath: string, destDir: string): Promise<void> {
  const { file, args } = extractCommand(process.platform, zipPath, destDir)
  await new Promise<void>((resolve, reject) => {
    const child = spawn(file, args, { windowsHide: true, stdio: 'pipe' })
    const errors: Buffer[] = []
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('解压超时'))
    }, EXTRACT_TIMEOUT_MS)
    child.stderr.on('data', (data: Buffer) => errors.push(data))
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(Buffer.concat(errors).toString('utf8').trim() || `解压退出码 ${code}`))
    })
  })
}
