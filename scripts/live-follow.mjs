/**
 * 真机关注验收入口：打包现有执行器并在独立 Electron 进程中运行。
 */
import { build } from 'vite'
import electron from 'electron'
import { spawn } from 'node:child_process'
import path from 'node:path'

const root = process.cwd()
await build({ configFile: false, build: { ssr: 'scripts/live-follow-runner.ts',
  outDir: 'out/live-follow-harness', emptyOutDir: false,
  rollupOptions: { external: ['electron'], output: { format: 'cjs', entryFileNames: 'runner.cjs' } } } })
const environment = { ...process.env }
delete environment.ELECTRON_RUN_AS_NODE
const child = spawn(electron, [path.join(root, 'out/live-follow-harness/runner.cjs'), root, ...process.argv.slice(2)],
  { windowsHide: true, stdio: 'inherit', env: environment })
child.on('error', (error) => { console.error(error); process.exitCode = 1 })
child.on('exit', (code) => { process.exitCode = code ?? 1 })
