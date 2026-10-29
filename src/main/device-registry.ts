/**
 * 多设备会话管理：每台设备独立建立和释放代理连接。
 */
import { DeviceSession } from './session'
import { CompanionSession } from './companion-session'
import { CompanionStore } from './companion-client'
import type { DeviceSessionPort } from './session-port'
import type { SessionState } from '../shared/types'

export class DeviceRegistry {
  private readonly sessions = new Map<string, DeviceSessionPort>()
  private readonly pending = new Map<string, Promise<void>>()
  readonly companions = new CompanionStore()

  /** 建立指定设备会话；同一序列号的并发连接复用同一次操作。 */
  connect(serial: string): Promise<void> {
    const existing = this.pending.get(serial)
    if (existing) return existing
    const operation = this.disconnect(serial)
      .then(async (): Promise<DeviceSessionPort> => serial.startsWith('direct:')
        ? CompanionSession.open(await this.companions.get(serial))
        : DeviceSession.open(serial))
      .then((session) => { this.sessions.set(serial, session) })
    this.pending.set(serial, operation)
    void operation.finally(() => { this.pending.delete(serial) }).catch(() => {})
    return operation
  }

  /** 断开指定设备；若连接仍在建立，等待后再清理。 */
  async disconnect(serial: string): Promise<void> {
    await this.pending.get(serial)?.catch(() => {})
    const session = this.sessions.get(serial)
    this.sessions.delete(serial)
    await session?.close()
  }

  /** 返回已连接会话；离线或尚未连接时明确报错。 */
  require(serial: string): DeviceSessionPort {
    const session = this.sessions.get(serial)
    if (!session) throw new Error(`设备 ${serial} 未连接`)
    if (!session.isAlive()) throw new Error(`设备 ${serial} 的辅助服务已断开，请重新连接`)
    return session
  }

  has(serial: string): boolean { return this.sessions.get(serial)?.isAlive() ?? false }
  /** 直连投屏要求会话本身保持认证状态。 */
  requireCompanion(serial: string): CompanionSession {
    const session = this.require(serial)
    if (!(session instanceof CompanionSession)) throw new Error('该设备并非手机端直连')
    return session
  }
  states(): SessionState[] { return [...this.sessions.entries()].filter(([, session]) => session.isAlive()).map(([serial]) => ({ serial, connected: true })) }
  async closeAll(): Promise<void> {
    const serials = new Set([...this.sessions.keys(), ...this.pending.keys()])
    await Promise.all([...serials].map((serial) => this.disconnect(serial)))
  }
}
