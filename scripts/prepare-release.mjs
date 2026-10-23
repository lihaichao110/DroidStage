/**
 * 发行产物检查：确认各平台安装包齐全，并为最终发布生成校验清单。
 */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { version, build } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const productName = build.productName
const target = process.argv[2]
const output = path.resolve(process.argv[3] ?? path.join(root, 'release'))
const expected = {
  win: [`${productName}-Setup-${version}-x64.exe`],
  mac: ['x64', 'arm64'].flatMap((arch) => ['dmg', 'zip'].map((ext) => `${productName}-${version}-${arch}.${ext}`))
}
expected.all = [...expected.win, ...expected.mac]

if (!Object.hasOwn(expected, target)) throw new Error('用法：node scripts/prepare-release.mjs win|mac|all [产物目录]')

const files = (await readdir(output)).filter((name) => /\.(exe|dmg|zip)$/.test(name)).sort()
const required = expected[target].sort()
if (JSON.stringify(files) !== JSON.stringify(required)) {
  throw new Error(`发行安装包不完整：期望 ${required.join(', ')}；实际 ${files.join(', ') || '无'}`)
}
for (const name of required) {
  const info = await stat(path.join(output, name))
  if (!info.isFile() || !info.size) throw new Error(`发行安装包无效：${name}`)
}

/**
 * 流式计算大安装包的 SHA-256，避免一次载入内存。
 * @param {string} file 安装包路径
 * @returns {Promise<string>} 小写十六进制摘要
 */
async function sha256(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

if (target === 'all') {
  const lines = []
  for (const name of required) lines.push(`${await sha256(path.join(output, name))}  ${name}`)
  await writeFile(path.join(output, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`)
}
console.log(`${target} 发行安装包校验通过`)
