import net from 'node:net'
import type { Selector } from '../shared/types'

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }

export class AgentClient {
  private socket: net.Socket
  private token: string
  private buffer = ''
  private nextId = 1
  private pending = new Map<number, Pending>()
  private closed = false

  private constructor(socket: net.Socket, token: string) {
    this.socket = socket
    this.token = token
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => this.receive(chunk))
    socket.on('error', (error) => this.failAll(error))
    socket.on('close', () => this.failAll(new Error('手机辅助服务已断开')))
  }

  static connect(port: number, token: string): Promise<AgentClient> {
    return new Promise((resolve, reject) => {
      const socket = net.connect({ host: '127.0.0.1', port })
      socket.once('error', reject)
      socket.once('connect', () => {
        socket.removeListener('error', reject)
        resolve(new AgentClient(socket, token))
      })
    })
  }

  request<T>(op: string, args: Record<string, unknown> = {}, timeoutMs = 15000): Promise<T> {
    if (this.closed) return Promise.reject(new Error('手机辅助服务未连接'))
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`操作超时：${op}`))
      }, timeoutMs)
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer })
      this.socket.write(JSON.stringify({ id, token: this.token, op, args }) + '\n')
    })
  }

  async count(selector: Selector): Promise<number> {
    return this.request<number>('count', { selector })
  }

  close(): void {
    if (this.closed) return
    this.socket.destroy()
    this.failAll(new Error('连接已关闭'))
  }

  private receive(chunk: string): void {
    this.buffer += chunk
    if (this.buffer.length > 20_000_000) {
      this.close()
      return
    }
    let breakAt = this.buffer.indexOf('\n')
    while (breakAt >= 0) {
      const line = this.buffer.slice(0, breakAt)
      this.buffer = this.buffer.slice(breakAt + 1)
      try {
        const message = JSON.parse(line) as { id: number; ok: boolean; result?: unknown; error?: string }
        const pending = this.pending.get(message.id)
        if (pending) {
          clearTimeout(pending.timer)
          this.pending.delete(message.id)
          if (message.ok) pending.resolve(message.result)
          else pending.reject(new Error(message.error || '手机操作失败'))
        }
      } catch (error) {
        this.failAll(error instanceof Error ? error : new Error('通信数据无效'))
      }
      breakAt = this.buffer.indexOf('\n')
    }
  }

  private failAll(error: Error): void {
    this.closed = true
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }
}
