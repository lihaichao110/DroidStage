/**
 * Windows 安装包冒烟检查：验证随包资源完整，并在不依赖构建机工具链的环境中启动 ADB。
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { version, build } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const installer = path.join(root, 'release', `${build.productName}-Setup-${version}-x64.exe`)
const resources = path.join(root, 'release', 'win-unpacked', 'resources')
const adbDir = path.join(resources, 'adb', 'win32')

for (const file of [
  installer,
  path.join(resources, 'agent', 'host.apk'),
  path.join(resources, 'agent', 'test.apk'),
  path.join(resources, 'mirroring', 'scrcpy-server'),
  path.join(resources, 'adb', 'THIRD_PARTY_NOTICES')
]) {
  if (!statSync(file).isFile() || statSync(file).size === 0) throw new Error(`安装包资源无效：${file}`)
}

const manifest = JSON.parse(readFileSync(path.join(adbDir, 'manifest.json'), 'utf8'))
for (const item of manifest.files) {
  const hash = createHash('sha256').update(readFileSync(path.join(adbDir, item.name))).digest('hex')
  if (hash !== item.sha256) throw new Error(`打包后的 ADB 文件校验失败：${item.name}`)
}

// 只保留 Windows 系统目录，避免构建机安装的 MSYS2/GCC 替安装包补齐缺失 DLL。
const systemDir = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')
const result = spawnSync(path.join(adbDir, 'adb.exe'), ['version'], {
  encoding: 'utf8',
  timeout: 15000,
  windowsHide: true,
  env: { ...process.env, PATH: systemDir, Path: systemDir }
})
if (result.error || result.status !== 0 || !result.stdout.includes('Android Debug Bridge')) {
  throw new Error(`打包后的 ADB 无法独立启动：${result.error?.message ?? result.stderr ?? `退出码 ${result.status}`}`)
}
console.log(`Windows 安装包与 ADB 启动检查通过：${installer}`)
