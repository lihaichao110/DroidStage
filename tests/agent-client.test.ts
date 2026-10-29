/**
 * 直连协议回归：验证异步视频事件、请求关联和断线后的失败传播。
 */
import net from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentClient } from '../src/main/agent-client'

const servers: net.Server[] = []

/** 建立本地协议对端，避免测试依赖真实手机和端口。 */
async function fixture(onLine: (line: string, socket: net.Socket) => void,
  onEvent?: (event: Record<string, unknown>) => void): Promise<AgentClient> {
  const server = net.createServer((socket) => {
    let buffer = ''
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      let end = buffer.indexOf('\n')
      while (end >= 0) {
        onLine(buffer.slice(0, end), socket)
        buffer = buffer.slice(end + 1)
        end = buffer.indexOf('\n')
      }
    })
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('测试端口无效')
  const socket = net.connect({ host: '127.0.0.1', port: address.port })
  await new Promise<void>((resolve) => socket.once('connect', resolve))
  return AgentClient.fromSocket(socket, 'secret', onEvent)
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

describe('AgentClient 直连协议', () => {
  it('视频事件夹在请求响应之间时仍返回正确结果', async () => {
    const events: Record<string, unknown>[] = []
    const client = await fixture((line, socket) => {
      const request = JSON.parse(line) as { id: number; token: string }
      expect(request.token).toBe('secret')
      socket.write(JSON.stringify({ event: 'video', data: 'AQID' }) + '\n')
      socket.write(JSON.stringify({ id: request.id, ok: true, result: { accessibility: true } }) + '\n')
    }, (event) => events.push(event))
    await expect(client.request('status')).resolves.toEqual({ accessibility: true })
    expect(events).toEqual([{ event: 'video', data: 'AQID' }])
    client.close()
  })

  it('连接断开时立即拒绝等待中的任务', async () => {
    const client = await fixture((_line, socket) => socket.destroy())
    await expect(client.request('screenshot', {}, 5000)).rejects.toThrow('断开')
    expect(client.isConnected()).toBe(false)
  })
})
