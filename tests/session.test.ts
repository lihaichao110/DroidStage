/**
 * 设备会话测试：验证启动服务的范围及控件快照请求复用。
 */
import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { AgentClient } from '../src/main/agent-client'
import { adb, adbSpawn } from '../src/main/adb'
import type { HierarchySnapshot, Selector } from '../src/shared/types'

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
type SessionInternals = { client: AgentClient | null; hostPort: number | null; token: string | null }

/** 构造私有构造器的会话实例并注入假代理客户端，绕开真实设备初始化。 */
function makeSession(request: RequestFn): DeviceSession {
  const session = new (DeviceSession as unknown as new (serial: string) => DeviceSession)('test-serial')
  // 附带 close 桩：主连接重建路径会关闭旧客户端，避免注入对象缺方法
  ;(session as unknown as { client: AgentClient | null }).client = { request, close: vi.fn() } as unknown as AgentClient
  return session
}

/** 在 makeSession 基础上补齐端口与令牌，供快查询通道与主连接重建相关用例使用。 */
function makeSessionWithPort(request: RequestFn): DeviceSession {
  const session = makeSession(request)
  const internals = session as unknown as SessionInternals
  internals.hostPort = 45678
  internals.token = 'token'
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

  it('snapshot 超时后重建主连接，下一次刷新走新连接', async () => {
    const request = vi.fn(async (op: string) => {
      if (op === 'snapshot') throw new Error('操作超时：snapshot（30 秒未收到手机端响应）')
      return 'pong'
    })
    const session = makeSessionWithPort(request)
    const stale = ((session as unknown as SessionInternals).client as unknown as { close: ReturnType<typeof vi.fn> })
    const fresh = { request: vi.fn().mockResolvedValue(XML), close: vi.fn() } as unknown as AgentClient
    const connect = vi.spyOn(AgentClient, 'connect').mockResolvedValue(fresh)
    try {
      await expect(session.snapshot()).rejects.toThrow('操作超时：snapshot')
      // 重建先关闭疑似卡死的旧连接，替换成完成 ping 握手的新连接
      expect(stale.close).toHaveBeenCalledOnce()
      expect((session as unknown as SessionInternals).client).toBe(fresh)
      expect(fresh.request).toHaveBeenCalledWith('ping', {}, 1000)
      const result = await session.snapshot()
      expect(result.nodes).toHaveLength(1)
      expect(fresh.request).toHaveBeenCalledWith('snapshot', {}, 30000)
    } finally { connect.mockRestore() }
  })

  it('非连接类失败不触发主连接重建', async () => {
    // 空层级在解析阶段即报"控件树格式无效"，属于业务失败，连接应当保持原样
    const request = vi.fn().mockResolvedValue('<?xml version="1.0" encoding="UTF-8"?><hierarchy></hierarchy>')
    const session = makeSessionWithPort(request)
    const connect = vi.spyOn(AgentClient, 'connect')
    try {
      await expect(session.snapshot()).rejects.toThrow('控件树格式无效')
      expect(connect).not.toHaveBeenCalled()
    } finally { connect.mockRestore() }
  })
})

describe('快查询通道', () => {
  const selector: Selector = { kind: 'text', value: '登录' }

  /** 构造带 count/request/isConnected 的假代理客户端。 */
  function fakeClient(overrides: Partial<{ count: number; result: unknown; alive: boolean }>) {
    return {
      request: vi.fn().mockImplementation(async (op: string) => op === 'ping' ? 'pong' : overrides.result),
      count: vi.fn().mockResolvedValue(overrides.count ?? 1),
      isConnected: vi.fn().mockReturnValue(overrides.alive ?? true),
      close: vi.fn()
    }
  }

  it('count 校验走独立快查询连接，不占用主连接', async () => {
    const session = makeSessionWithPort(vi.fn())
    const quick = fakeClient({ count: 1 })
    const connect = vi.spyOn(AgentClient, 'connect').mockResolvedValue(quick as unknown as AgentClient)
    try {
      await expect(session.count(selector)).resolves.toBe(1)
      expect(connect).toHaveBeenCalledWith(45678, 'token')
      expect(quick.count).toHaveBeenCalledWith(selector, 0)
      // 懒连接复用：再次查询不再新建连接
      await expect(session.count(selector)).resolves.toBe(1)
      expect(connect).toHaveBeenCalledTimes(1)
    } finally { connect.mockRestore() }
  })

  it('matches 定位细化查询同样走快查询通道', async () => {
    const session = makeSessionWithPort(vi.fn())
    const matches = [{ index: 1, bounds: { left: 0, top: 0, right: 100, bottom: 100 } }]
    const quick = fakeClient({ result: matches })
    const connect = vi.spyOn(AgentClient, 'connect').mockResolvedValue(quick as unknown as AgentClient)
    try {
      await expect(session.matches(selector)).resolves.toEqual(matches)
      expect(quick.request).toHaveBeenCalledWith('inspectMatches', { selector })
    } finally { connect.mockRestore() }
  })

  it('快通道断线后下次查询自动重建连接', async () => {
    const session = makeSessionWithPort(vi.fn())
    const first = fakeClient({ count: 1, alive: false })
    const second = fakeClient({ count: 2, alive: true })
    const connect = vi.spyOn(AgentClient, 'connect')
      .mockResolvedValueOnce(first as unknown as AgentClient)
      .mockResolvedValueOnce(second as unknown as AgentClient)
    try {
      await expect(session.count(selector)).resolves.toBe(1)
      await expect(session.count(selector)).resolves.toBe(2)
      expect(connect).toHaveBeenCalledTimes(2)
      expect(first.close).toHaveBeenCalledOnce()
    } finally { connect.mockRestore() }
  })
})
