import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const target = process.argv[2]
const targets = target === 'win' ? ['win32'] : target === 'mac' ? ['darwin-x64', 'darwin-arm64'] : []
if (!targets.length) throw new Error('用法：node scripts/verify-release.mjs win|mac')
for (const file of ['assets/agent/host.apk', 'assets/agent/test.apk', 'assets/adb/NOTICE', 'assets/adb/THIRD_PARTY_NOTICES', 'assets/mirroring/scrcpy-server', 'assets/mirroring/NOTICE.md', 'assets/mirroring/LICENSE']) {
  const full = path.join(root, file)
  const info = await stat(full)
  if (!info.isFile() || !info.size) throw new Error(`发行组件无效：${file}`)
}
// scrcpy-server 是再分发的第三方二进制，必须与 manifest 登记的官方产物逐字节一致
const mirroring = JSON.parse(await readFile(path.join(root, 'assets/mirroring/manifest.json'), 'utf8'))
if (!/^\d+\.\d+(\.\d+)?$/.test(mirroring.version) || !/^[0-9a-f]{64}$/.test(mirroring.sha256)) throw new Error('scrcpy-server 清单无效')
const serverBinary = await readFile(path.join(root, 'assets/mirroring/scrcpy-server'))
if (createHash('sha256').update(serverBinary).digest('hex') !== mirroring.sha256) throw new Error('scrcpy-server 校验失败')
for (const platform of targets) {
  const dir = path.join(root, 'assets', 'adb', platform)
  const manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'))
  if (!/^[0-9a-f]{40}$/.test(manifest.aospRevision)) throw new Error(`${platform} 缺少固定 AOSP 修订号`)
  if (!Array.isArray(manifest.files) || !manifest.files.length) throw new Error(`${platform} 缺少文件清单`)
  for (const item of manifest.files) {
    if (!/^[\w.\-]+$/.test(item.name) || !/^[0-9a-f]{64}$/.test(item.sha256)) throw new Error('ADB 文件清单无效')
    const binary = await readFile(path.join(dir, item.name))
    if (createHash('sha256').update(binary).digest('hex') !== item.sha256) throw new Error(`${platform}/${item.name} 校验失败`)
  }
  const executable = path.join(dir, platform === 'win32' ? 'adb.exe' : 'adb')
  await stat(executable)
}
console.log(`${target} 发行组件校验通过`)
