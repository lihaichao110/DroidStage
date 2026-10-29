/**
 * 手机端直连协议：经 USB 配对固定 TLS 证书，再用局域网地址建立已认证会话。
 */
import { app } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import tls from 'node:tls'
import { AgentClient } from './agent-client'
import { adb, onDevice } from './adb'
import { validateLegacyIp } from './wireless-adb'

const COMPANION_PORT = 39828 // 手机应用的独立 TLS 服务端口
export type PairedCompanion = { serial: string; deviceId: string; model: string; ip: string; fingerprint: string; token: string }
export type VideoEvent = { event: 'video'; data: string }

/** 证书指纹只在 USB 首次配对时建立信任，后续连接必须完全一致。 */
export function verifyFingerprint(actual: string | undefined, expected: string): void {
  if (!actual || actual.toUpperCase() !== expected.toUpperCase()) throw new Error('手机端证书已变化，请重新通过 USB 配对')
}

/** 将系统网络错误映射为用户可操作的恢复步骤，保留原始诊断信息。 */
export function companionError(error: unknown, ip: string): Error {
  const reason = error instanceof Error ? error.message : String(error)
  if (/ECONNREFUSED|10061|actively refused|积极拒绝/i.test(reason)) {
    return new Error(`手机 ${ip} 的直连服务未开放 39828 端口。请在手机上的 DroidStage 点击“启动无线服务”，确认手机与电脑仍在同一 Wi‑Fi。原始错误：${reason}`)
  }
  if (/ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|超时/i.test(reason)) {
    return new Error(`连接手机 ${ip} 的直连服务超时。请在手机上查看“无线服务”是否仍为已启动，并核对当前 Wi‑Fi IP 与两端网络。原始错误：${reason}`)
  }
  return error instanceof Error ? error : new Error(reason)
}

/** 管理应用私有目录中的已配对手机记录。 */
export class CompanionStore {
  private file(): string { return path.join(app.getPath('userData'), 'paired-companions.json') }

  async list(): Promise<PairedCompanion[]> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.file(), 'utf8'))
      if (!Array.isArray(parsed)) return []
      return parsed.filter((item): item is PairedCompanion => typeof item === 'object' && item !== null &&
        typeof item.serial === 'string' && typeof item.ip === 'string' && typeof item.fingerprint === 'string' &&
        typeof item.token === 'string' && typeof item.model === 'string')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }

  /** 按设备身份覆盖旧地址；新 IP 只在持有原证书和 token 时才会被接受。 */
  async save(item: PairedCompanion): Promise<void> {
    const items = (await this.list()).filter((current) => current.serial !== item.serial)
    items.push(item)
    await writeFile(this.file(), JSON.stringify(items, null, 2), { encoding: 'utf8', mode: 0o600 })
  }

  async get(serial: string): Promise<PairedCompanion> {
    const item = (await this.list()).find((entry) => entry.serial === serial)
    if (!item) throw new Error('手机尚未通过 USB 配对')
    return item
  }
}

/** 创建 TLS 连接；预配对仅允许 ADB 本地转发，正式连接先校验证书再传密钥。 */
export function openCompanionSocket(host: string, port: number, fingerprint?: string): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, rejectUnauthorized: false })
    const timer = setTimeout(() => socket.destroy(new Error('连接手机端服务超时')), 7000)
    socket.once('secureConnect', () => {
      clearTimeout(timer)
      try {
        if (fingerprint) verifyFingerprint(socket.getPeerCertificate().fingerprint256, fingerprint)
        resolve(socket)
      } catch (error) { socket.destroy(); reject(error) }
    })
    socket.once('error', (error) => { clearTimeout(timer); reject(error) })
  })
}

/** 从 USB 端口转发配对，确保密钥不会发给局域网上的未验证主机。 */
export async function pairCompanion(usbSerial: string, ip: string, store: CompanionStore): Promise<PairedCompanion> {
  validateLegacyIp(ip)
  const hostPort = Number((await adb(onDevice(usbSerial, ['forward', 'tcp:0', `tcp:${COMPANION_PORT}`]))).toString().trim())
  if (!Number.isInteger(hostPort) || hostPort <= 0) throw new Error('USB 配对端口映射失败')
  try {
    const socket = await openCompanionSocket('127.0.0.1', hostPort)
    const fingerprint = socket.getPeerCertificate().fingerprint256
    if (!fingerprint) throw new Error('手机端未提供 TLS 证书')
    const client = AgentClient.fromSocket(socket, '')
    try {
      const result = await client.request<{ token: string; deviceId: string; model: string }>('pair', {}, 7000)
      if (!result.token || !result.deviceId || !result.model) throw new Error('手机端配对数据无效')
      const item = { serial: `direct:${result.deviceId}`, deviceId: result.deviceId, model: result.model, ip, fingerprint, token: result.token }
      // USB 提供身份锚点；保存前再从指定 Wi-Fi 地址验证证书和密钥，避免写入错误 IP 后误报配对可用。
      const lan = await openCompanionSocket(ip, COMPANION_PORT, fingerprint).catch((error) => { throw companionError(error, ip) })
      const probe = AgentClient.fromSocket(lan, result.token)
      try { await probe.request('status', {}, 7000) } finally { probe.close() }
      await store.save(item)
      return item
    } finally { client.close() }
  } finally {
    await adb(onDevice(usbSerial, ['forward', '--remove', `tcp:${hostPort}`]), 3000).catch(() => {})
  }
}

/** 局域网连通后还要读取真实权限状态，避免端口打开就误报任务和投屏可用。 */
export async function connectCompanion(item: PairedCompanion, onVideo?: (event: VideoEvent) => void): Promise<AgentClient> {
  const socket = await openCompanionSocket(item.ip, COMPANION_PORT, item.fingerprint)
    .catch((error) => { throw companionError(error, item.ip) })
  const client = AgentClient.fromSocket(socket, item.token, (event) => {
    if (event.event === 'video' && typeof event.data === 'string') onVideo?.(event as VideoEvent)
  })
  try {
    const status = await client.request<{ accessibility: boolean; projection: boolean }>('status', {}, 7000)
    if (!status.accessibility) throw new Error('手机端无障碍服务未启用，请在手机上授权')
    if (!status.projection) throw new Error('手机端尚未获得录屏授权，请在手机应用中点击“允许录屏和投屏”')
    return client
  } catch (error) { client.close(); throw error }
}
