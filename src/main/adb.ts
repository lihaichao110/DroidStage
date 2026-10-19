/**
 * ADB 进程封装：先确保二进制可用（开发模式含自动下载，见 adb-provision.ts），再执行命令并收集输出。
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { Device } from '../shared/types'
import { ensureAdb } from './adb-provision'

export async function adbSpawn(args: string[]): Promise<ChildProcessWithoutNullStreams> {
  return spawn(await ensureAdb(), args, { windowsHide: true, stdio: 'pipe' })
}

export async function adb(args: string[], timeoutMs = 15000, maxBytes = 25_000_000): Promise<Buffer> {
  const child = await adbSpawn(args)
  const chunks: Buffer[] = []
  const errors: Buffer[] = []
  let bytes = 0
  let settled = false
  return new Promise<Buffer>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill()
      finish(new Error(`ADB 超时：${args[0] ?? ''}`))
    }, timeoutMs)
    function finish(error?: Error, result?: Buffer): void {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(result ?? Buffer.alloc(0))
    }
    child.stdout.on('data', (data: Buffer) => {
      bytes += data.length
      if (bytes > maxBytes) {
        child.kill()
        finish(new Error('ADB 输出超过安全上限'))
      } else chunks.push(data)
    })
    child.stderr.on('data', (data: Buffer) => errors.push(data))
    child.on('error', (error) => finish(error))
    child.on('close', (code) => {
      if (code === 0) finish(undefined, Buffer.concat(chunks))
      else finish(new Error(Buffer.concat(errors).toString('utf8').trim() || `ADB 退出码 ${code}`))
    })
  })
}

export async function listDevices(): Promise<Device[]> {
  const output = (await adb(['devices', '-l'])).toString('utf8')
  return output.split(/\r?\n/).slice(1).filter(Boolean).map((line) => {
    const parts = line.trim().split(/\s+/)
    const model = parts.find((part) => part.startsWith('model:'))?.slice(6)
    return { serial: parts[0], state: parts[1], model, usb: !parts[0].includes(':') }
  }).filter((device) => device.serial && device.state)
}

export function onDevice(serial: string, args: string[]): string[] {
  if (!/^[\w.:\-]+$/.test(serial)) throw new Error('设备序列号无效')
  return ['-s', serial, ...args]
}
