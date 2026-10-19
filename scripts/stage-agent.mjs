import { copyFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.join(root, 'assets', 'agent')
await mkdir(output, { recursive: true })
await copyFile(path.join(root, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk'), path.join(output, 'host.apk'))
await copyFile(path.join(root, 'android', 'app', 'build', 'outputs', 'apk', 'androidTest', 'debug', 'app-debug-androidTest.apk'), path.join(output, 'test.apk'))
console.log(`辅助 APK 已复制到 ${output}`)
