/**
 * 设备会话测试：验证启动服务的范围及控件快照请求复用。
 */
import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { AgentClient } from '../src/main/agent-client'
import { adb, adbSpawn } from '../src/main/adb'
import type { HierarchySnapshot } from '../src/shared/types'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', getAppPath: () => '/app', isPackaged: false } }))
vi.mock('node:fs', () => ({ existsSync: () => true }))
vi.mock('../src/main/adb', () => ({
  adb: vi.fn(), adbSpawn: vi.fn(),
  listDevices: async () => [{ serial: 'test-serial', state: 'device' }],
  onDevice: (serial: string, args: string[]) => ['-s', serial, ...args]
}))
import { DeviceSession } from '../src/main/session'

// 合法最小层级 XML：单个根节点，bounds 决定快照推算出的屏幕宽高
const XML = '<?xml version="1.0" encoding="UTF-8"?><hierarchy><node bounds="[0,0][1080,2400]" package="com.example"/></hierarchy>'

type RequestFn = (op: string, args: Record<string, unknown>, timeoutMs?: number) => Promise<string>

/** 构造私有构造器的会话实例并注入假代理客户端，绕开真实设备初始化。 */
function makeSession(request: RequestFn): DeviceSession {
  const session = new (DeviceSession as unknown as new (serial: string) => DeviceSession)('test-serial')
  ;(session as unknown as { client: AgentClient | null }).client = { request } as unknown as AgentClient
  return session
}

describe('会话快照', () => {
  it('正式会话仅启动代理服务，不执行 APK 内的模拟页面测试', async () => {
    vi.mocked(adb).mockImplementation(async (args) => Buffer.from(
      args.includes('getprop') ? '29' : args.includes('tcp:0') ? '45678' : 'Success'
    ))
    const child = { stdout: new EventEmitter(), stderr: new EventEmitter(), exitCode: null, kill: vi.fn() }
    vi.mocked(adbSpawn).mockResolvedValue(child as unknown as Awaited<ReturnType<typeof adbSpawn>>)
    const client = { request: vi.fn().mockResolvedValue('pong'), close: vi.fn() }
    const connect = vi.spyOn(AgentClient, 'connect').mockResolvedValue(client as unknown as AgentClient)
    try {
      const session = await DeviceSession.open('test-serial')
      const args = vi.mocked(adbSpawn).mock.calls.at(-1)![0]
      expect(args.slice(args.indexOf('class') - 1, args.indexOf('class') + 2))
        .toEqual(['-e', 'class', 'dev.androidautodesk.host.AgentTest#serve'])
      await session.close()
      expect(child.kill).toHaveBeenCalledOnce()
    } finally { connect.mockRestore() }
  })

  it('并发快照复用在途请求，只向手机端发送一次', async () => {
    let respond!: (xml: string) => void
    const request = vi.fn<RequestFn>(() => new Promise<string>((resolve) => { respond = resolve }))
    const session = makeSession(request)
    const first = session.snapshot()
    const second = session.snapshot()
    respond(XML)
    const [a, b]: HierarchySnapshot[] = await Promise.all([first, second])
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0][0]).toBe('snapshot')
    expect(b).toBe(a)
    expect(a.width).toBe(1080)
    expect(a.height).toBe(2400)
    expect(a.nodes).toHaveLength(1)
  })

  it('上一次落定后才发起下一次，失败也会清空在途标记', async () => {
    let shouldFail = true
    const request = vi.fn(async () => {
      if (shouldFail) throw new Error('操作超时：snapshot')
      return XML
    })
    const session = makeSession(request)
    await expect(session.snapshot()).rejects.toThrow('操作超时：snapshot')
    shouldFail = false
    const result = await session.snapshot()
    expect(request).toHaveBeenCalledTimes(2)
    expect(result.nodes[0]?.packageName).toBe('com.example')
  })
})
