import { createHash } from 'node:crypto'
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const [platform, aospRevision, sourceDir, noticeFile] = process.argv.slice(2)
if (!['win32', 'darwin-x64', 'darwin-arm64'].includes(platform) || !/^[0-9a-f]{40}$/.test(aospRevision ?? '') || !sourceDir || !noticeFile) {
  throw new Error('用法：node scripts/stage-adb.mjs win32|darwin-x64|darwin-arm64 <40位AOSP修订号> <自构建输出目录> <第三方许可清单>')
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const target = path.join(root, 'assets', 'adb', platform)
const source = path.resolve(sourceDir)
const names = (await readdir(source)).filter((name) => /^[\w.\-]+$/.test(name) && name !== 'manifest.json')
if (!names.includes(platform === 'win32' ? 'adb.exe' : 'adb')) throw new Error('构建输出缺少 ADB 可执行文件')
await mkdir(target, { recursive: true })
const files = []
for (const name of names) {
  const data = await readFile(path.join(source, name))
  if (!data.length) throw new Error(`空文件：${name}`)
  await copyFile(path.join(source, name), path.join(target, name))
  files.push({ name, sha256: createHash('sha256').update(data).digest('hex') })
}
await copyFile(path.resolve(noticeFile), path.join(root, 'assets', 'adb', 'THIRD_PARTY_NOTICES'))
await writeFile(path.join(target, 'manifest.json'), JSON.stringify({ aospRevision, files }, null, 2) + '\n')
console.log(`已登记 ${platform} 自构建 ADB，共 ${files.length} 个文件`)
