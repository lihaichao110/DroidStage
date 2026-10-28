/**
 * 真机关注验收：复用正式遍历逻辑，限量点击并保存逐次状态与截图证据。
 */
import { app } from 'electron'
import { mkdir, readFile, writeFile, appendFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { DeviceSession } from '../src/main/session'
import { runListClick } from '../src/main/list-runner'
import { validateTask } from '../src/shared/task'
import { adb, onDevice } from '../src/main/adb'
import type { StateListRow } from '../src/shared/types'

const [root, serial, taskFile, limitText = '30', intervalText = '8000'] = process.argv.slice(2)
const limit = Number(limitText)
// 点击间隔：抖音会对连续快速关注触发身份安全验证，间隔须模拟人工节奏
const intervalMs = Number(intervalText)
const targetReached = new Error('已达到本次验收数量')
let session: DeviceSession | undefined
let successes = 0
let attempts = 0
let scrolls = 0
let failures = 0
const directory = path.join(root, 'out/live-follow', new Date().toISOString().replace(/[:.]/g, '-'))

/** 写入每次操作的实际结果，失败或中断也保留已发生的点击。 */
async function record(data: Record<string, unknown>): Promise<void> {
  await appendFile(path.join(directory, 'events.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...data }) + '\n')
}

/** 检测抖音风控弹窗是否覆盖页面；出现时一切点击都会落空，必须停止而非空转。 */
async function isCaptchaBlocked(): Promise<boolean> {
  const output = (await adb(onDevice(serial, ['shell', 'dumpsys', 'window'])).catch(() => Buffer.alloc(0))).toString('utf8')
  return output.includes('IdentityDialogActivity')
}

/** 检测手机是否熄屏；锁屏后控件树不含目标页面，继续执行只会得到误导性的扫描失败。 */
async function isScreenAsleep(): Promise<boolean> {
  const output = (await adb(onDevice(serial, ['shell', 'dumpsys', 'power'])).catch(() => Buffer.alloc(0))).toString('utf8')
  return output.includes('mWakefulness=Asleep')
}

/** 用户确认策略：风控弹窗出现即停止本次验收，由人工决定后续，绝不对抗风控。 */
async function ensureNoCaptcha(): Promise<void> {
  if (await isScreenAsleep()) throw new Error('手机已熄屏或锁屏，请亮屏解锁后重跑')
  if (!(await isCaptchaBlocked())) return
  await record({ phase: 'captcha', note: '检测到风控弹窗，按策略停止' })
  throw new Error(`抖音已触发身份安全验证风控，已停止点击（成功 ${successes}/${limit}）；请在手机上人工处理后重跑`)
}

/** 运行只读检查或限量验收；成功必须来自手机原行完成状态。 */
async function main(): Promise<void> {
  if (!serial || !Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('需要设备序列号，验收数量须为 1–50')
  if (!Number.isInteger(intervalMs) || intervalMs < 0 || intervalMs > 60000) throw new Error('点击间隔须为 0–60000 毫秒')
  await mkdir(directory, { recursive: true })
  // 独立 Electron 进程需把仓库作为应用目录，才能读取本地代理 APK。
  ;(app as typeof app & { setAppPath(directory: string): void }).setAppPath(root)
  await app.whenReady()
  session = await DeviceSession.open(serial)
  const before = await session.snapshot()
  await writeFile(path.join(directory, 'before.json'), JSON.stringify(before, null, 2))
  await writeFile(path.join(directory, 'before.png'), await session.screenshot())
  if (!taskFile) {
    console.log(JSON.stringify(before.nodes.map(({ depth, text, description, resourceId, className, bounds, scrollable }) =>
      ({ depth, text, description, resourceId, className, bounds, scrollable }))))
    return
  }
  if ((await stat(taskFile)).size > 1_000_000) throw new Error('任务文件过大')
  const task = JSON.parse(await readFile(taskFile, 'utf8'))
  validateTask(task)
  if (task.steps.length !== 1 || task.steps[0].type !== 'listClick' || task.steps[0].mode !== 'rowState') {
    throw new Error('验收任务必须仅包含一个按行状态遍历步骤')
  }
  const step = task.steps[0]
  await writeFile(path.join(directory, 'task.json'), JSON.stringify(task, null, 2))
  const agent = session.agent()
  const request = <T>(op: string, args: Record<string, unknown>, timeoutMs?: number): Promise<T> =>
    agent.request<T>(op, args, timeoutMs)
  // 屏幕级复核基线：点击前后同一屏内“已关注”行数只增不减，比行位置更能对抗点击后的布局变化
  let completedBaseline: number | null = null
  // 包装通信只记录和限量，具体扫描、重叠去重和状态判断全部走正式执行器。
  agent.request = async <T>(op: string, args: Record<string, unknown> = {}, timeoutMs?: number): Promise<T> => {
    if (op === 'tapRow') {
      if (successes >= limit) throw targetReached
      if (++attempts > limit + 10) throw new Error('未确认点击过多，停止验收')
      // 点击前检查风控弹窗并保持冷却间隔，避免对着浮层空转
      await ensureNoCaptcha()
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
      await ensureNoCaptcha()
      await record({ phase: 'before', op, args })
    }
    const started = Date.now()
    const result = await request<T>(op, args, op === 'scanRows' ? 60000 : timeoutMs)
    await record({ phase: 'after', op, args, result, elapsedMs: Date.now() - started })
    if (op === 'scanRows' && Array.isArray(result)) {
      completedBaseline = (result as StateListRow[]).filter((row) => row.status === 'completed').length
    }
    if (op === 'tapRow') {
      const clicked = result as { ok: boolean }
      if (!clicked.ok) {
        failures++
        console.log(`已确认关注 ${successes}/${limit}，尝试 ${attempts} 次`)
        if (failures >= 6) throw new Error('已有六次点击未确认，停止验收')
        return result
      }
      // 手机端可能只确认点击动作；复核完成之前不能计入真实关注数。
      await new Promise((resolve) => setTimeout(resolve, 1500))
      await ensureNoCaptcha()
      const rows = await request<StateListRow[]>('scanRows', step, 60000).catch(async (error) => {
        await record({ phase: 'delayed-verification-retry', error: String(error) })
        await ensureNoCaptcha()
        await new Promise((resolve) => setTimeout(resolve, 3000))
        return request<StateListRow[]>('scanRows', step, 60000)
      })
      await record({ phase: 'delayed-verification', rows })
      const completedNow = rows.filter((row) => row.status === 'completed').length
      if (completedBaseline === null || completedNow <= completedBaseline) {
        throw new Error(`关注状态延迟复核失败（已关注 ${completedNow}，未多于基线 ${completedBaseline}），停止继续点击`)
      }
      successes++
      console.log(`已确认关注 ${successes}/${limit}，尝试 ${attempts} 次`)
      completedBaseline = completedNow
    }
    if (op === 'scrollList') {
      scrolls++
      await writeFile(path.join(directory, `screen-${scrolls}.png`), await session!.screenshot())
    }
    return result
  }
  try {
    // 上次运行可能把风控弹窗留在页面上，检测到即停止而不让执行器空转
    await ensureNoCaptcha()
    await runListClick(step, session, () => { if (successes >= limit) throw targetReached },
      async (name, reason) => { await record({ phase: 'skipped', name, reason }) })
  } catch (error) {
    if (error !== targetReached) throw error
  }
  if (successes !== limit) throw new Error(`列表遍历结束，仅确认 ${successes}/${limit} 次`)
}

/** 无论验收结果如何均释放代理，并保留最后画面。 */
async function finish(): Promise<void> {
  try {
    await main()
    await record({ phase: 'finished', successes, attempts, scrolls })
    console.log(JSON.stringify({ success: true, successes, attempts, scrolls, directory }))
  } catch (error) {
    console.error(error)
    await record({ phase: 'failed', error: String(error), successes, attempts, scrolls }).catch(() => {})
    process.exitCode = 1
  } finally {
    if (session) {
      await writeFile(path.join(directory, 'after.png'), await session.screenshot()).catch(() => {})
      await session.close()
    }
    app.exit(Number(process.exitCode ?? 0))
  }
}
void finish()
