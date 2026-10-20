import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentClient } from '../src/main/agent-client'

let closeServer: (() => Promise<void>) | undefined
afterEach(async () => { await closeServer?.(); closeServer = undefined })

describe('手机端通信', () => {
  it('使用请求 ID 对应并行响应，并跨数据分片接收', async () => {
    const server = createServer((socket) => {
      let input = ''
      socket.on('data', (chunk) => {
        input += chunk.toString()
        const lines = input.trim().split('\n')
        if (lines.length < 2) return
        const first = JSON.parse(lines[0]) as { id: number }
        const second = JSON.parse(lines[1]) as { id: number }
        socket.write(JSON.stringify({ id: second.id, ok: true, result: 2 }) + '\n')
        const reply = JSON.stringify({ id: first.id, ok: true, result: 1 }) + '\n'
        socket.write(reply.slice(0, 8))
        socket.write(reply.slice(8))
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    closeServer = () => new Promise<void>((resolve) => server.close(() => resolve()))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('无效测试端口')
    const client = await AgentClient.connect(address.port, 'test-token')
    expect(client.isConnected()).toBe(true)
    const result = await Promise.all([client.request<number>('one'), client.request<number>('two')])
    expect(result).toEqual([1, 2])
    client.close()
    expect(client.isConnected()).toBe(false)
  })

  it('传递中文文本并保留手机端错误', async () => {
    const server = createServer((socket) => {
      socket.once('data', (chunk) => {
        const request = JSON.parse(chunk.toString().trim()) as { id: number; token: string; args: { text: string } }
        expect(request.token).toBe('secret')
        expect(request.args.text).toBe('你好')
        socket.write(JSON.stringify({ id: request.id, ok: false, error: '未找到控件' }) + '\n')
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    closeServer = () => new Promise<void>((resolve) => server.close(() => resolve()))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('无效测试端口')
    const client = await AgentClient.connect(address.port, 'secret')
    await expect(client.request('input', { text: '你好' })).rejects.toThrow('未找到控件')
    client.close()
  })

  it('等待超时按操作名报错，迟到的响应被安全丢弃', async () => {
    const server = createServer((socket) => {
      let stalledId: number | null = null
      socket.on('data', (chunk) => {
        for (const line of chunk.toString().trim().split('\n')) {
          const request = JSON.parse(line) as { id: number; op: string }
          if (request.op === 'snapshot') {
            stalledId = request.id // 模拟手机端 dump 卡住：先不回包，等桌面端超时
            continue
          }
          // 后续请求到来时才补发早已超时的响应，验证客户端按 id 丢弃迟到结果且连接仍可用
          if (stalledId !== null) {
            socket.write(JSON.stringify({ id: stalledId, ok: true, result: 'late-xml' }) + '\n')
            stalledId = null
          }
          socket.write(JSON.stringify({ id: request.id, ok: true, result: 'pong' }) + '\n')
        }
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    closeServer = () => new Promise<void>((resolve) => server.close(() => resolve()))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('无效测试端口')
    const client = await AgentClient.connect(address.port, 'test-token')
    await expect(client.request('snapshot', {}, 60)).rejects.toThrow('操作超时：snapshot')
    await expect(client.request<string>('ping', {}, 1000)).resolves.toBe('pong')
    client.close()
  })
})
