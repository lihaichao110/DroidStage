/**
 * 任务执行器：逐步下发任务步骤到手机代理，并落盘运行日志与失败截图。
 */
import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AutomationTask, RunEvent, Step } from '../shared/types'
import { stepTypeName, validateTask } from '../shared/task'
import { DeviceSession } from './session'

export class TaskRunner {
  private cancelled = false
  private running = false

  cancel(): void { this.cancelled = true }
  isRunning(): boolean { return this.running }

  async run(task: AutomationTask, session: DeviceSession, emit: (event: RunEvent) => void): Promise<void> {
    if (this.running) throw new Error('已有任务在运行')
    validateTask(task)
    this.running = true
    this.cancelled = false
    const runDir = path.join(app.getPath('userData'), 'runs', `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`)
    const event = async (kind: RunEvent['kind'], message: string, stepIndex?: number): Promise<void> => {
      const item: RunEvent = { kind, at: new Date().toISOString(), message, stepIndex, runDir }
      await appendFile(path.join(runDir, 'events.jsonl'), JSON.stringify(item) + '\n', 'utf8')
      emit(item)
    }
    let failedIndex: number | undefined
    try {
      await mkdir(runDir, { recursive: true })
      await writeFile(path.join(runDir, 'task.json'), JSON.stringify(task, null, 2), 'utf8')
      // 包名可选：留空时跳过启动，步骤直接作用于手机当前界面——控件定位只依赖 selector 属性，与包名无关
      if (task.packageName) {
        await event('start', `启动 ${task.packageName}`)
        await session.launch(task.packageName)
      } else {
        await event('start', '未指定目标 App，直接在当前界面执行')
      }
      for (let index = 0; index < task.steps.length; index++) {
        if (this.cancelled) throw new CancelledError()
        const step = task.steps[index]
        await event('step', `第 ${index + 1} 步：${stepTypeName(step.type)}`, index)
        try {
          await this.executeStep(step, session, runDir, index)
        } catch (error) {
          failedIndex = index
          // 失败消息带上步骤序号与动作类型，否则手机端只回传“未找到控件”这类裸错误，用户无法分辨是哪一步出错
          throw new Error(`第 ${index + 1} 步（${stepTypeName(step.type)}）失败：${error instanceof Error ? error.message : String(error)}`)
        }
      }
      if (this.cancelled) throw new CancelledError()
      await event('success', '任务执行成功')
    } catch (error) {
      if (error instanceof CancelledError) {
        await event('cancelled', '任务已取消')
      } else {
        try { await writeFile(path.join(runDir, 'failure.png'), await session.screenshot()) } catch { /* disconnected */ }
        try { await event('failure', error instanceof Error ? error.message : String(error), failedIndex) } catch { /* file system failure */ }
        throw error
      }
    } finally {
      this.running = false
    }
  }

  private async executeStep(step: Step, session: DeviceSession, runDir: string, index: number): Promise<void> {
    const agent = session.agent()
    switch (step.type) {
      case 'tap':
        await agent.request('tap', { selector: step.selector, point: step.point, timeoutMs: step.timeoutMs }, step.timeoutMs + 3000)
        return
      case 'input':
        await agent.request('input', { selector: step.selector, text: step.text, timeoutMs: step.timeoutMs }, step.timeoutMs + 3000)
        return
      case 'swipe':
        await agent.request('swipe', { from: step.from, to: step.to, durationMs: step.durationMs })
        return
      case 'wait':
        await agent.request('wait', { selector: step.selector, exists: step.exists, timeoutMs: step.timeoutMs }, step.timeoutMs + 3000)
        return
      case 'assert': {
        const count = await session.count(step.selector)
        if (step.exists ? count !== 1 : count !== 0) throw new Error(`断言失败：匹配 ${count} 个控件`)
        return
      }
      case 'screenshot':
        await writeFile(path.join(runDir, `step-${String(index + 1).padStart(3, '0')}.png`), await session.screenshot())
        return
      case 'key':
        await agent.request('key', { key: step.key })
        return
    }
  }
}

class CancelledError extends Error {}
