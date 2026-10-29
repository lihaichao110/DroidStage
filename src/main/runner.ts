/**
 * 任务执行器：逐步下发任务步骤到手机代理，并落盘运行日志与失败截图。
 */
import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AutomationTask, BasicStep, ConditionStep, RunEvent } from '../shared/types'
import { flowStepNumber, stepSummary, validateTask } from '../shared/task'
import type { DeviceSessionPort } from './session-port'
import { runListClick } from './list-runner'
import { listSummary } from './list-summary'

const CONDITION_ONCE_WAIT_MS = 2000 // 判断一次时给动态页面留出控件树刷新时间，避免启动后立即误判不存在

export class TaskRunner {
  private cancelled = false
  private running = false

  cancel(): void { this.cancelled = true }
  isRunning(): boolean { return this.running }

  async run(task: AutomationTask, session: DeviceSessionPort, emit: (event: RunEvent) => void, context?: { batchId: string; serial: string; runDir: string }): Promise<void> {
    if (this.running) throw new Error('已有任务在运行')
    validateTask(task)
    this.running = true
    this.cancelled = false
    const runDir = context?.runDir ?? path.join(app.getPath('userData'), 'runs', `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`)
    const event = async (kind: RunEvent['kind'], message: string, stepIndex?: number): Promise<void> => {
      const item: RunEvent = { kind, at: new Date().toISOString(), message, stepIndex, runDir, batchId: context?.batchId, serial: context?.serial }
      await appendFile(path.join(runDir, 'events.jsonl'), JSON.stringify(item) + '\n', 'utf8')
      emit(item)
    }
    let failedIndex: number | undefined
    const lists = { rowSuccess: 0, rowSkipped: 0, identitySuccess: 0, identitySkipped: 0,
      identityDone: 0, hasRowState: false, hasIdentity: false }
    try {
      await mkdir(runDir, { recursive: true })
      await writeFile(path.join(runDir, 'task.json'), JSON.stringify(task, null, 2), 'utf8')
      // 包名可选：留空时跳过启动，步骤直接作用于手机当前界面——控件定位只依赖 selector 属性，与包名无关
      if (task.packageName) {
        await event('start', `第 1 步：打开应用 · 应用包名：${task.packageName}`)
        await session.launch(task.packageName)
      } else {
        await event('start', '未指定目标 App，直接在当前界面执行')
      }
      for (let index = 0; index < task.steps.length; index++) {
        if (this.cancelled) throw new CancelledError()
        const step = task.steps[index]
        const number = flowStepNumber(index, task.packageName)
        await event('step', `第 ${number} 步：${stepSummary(step)}`, index)
        try {
          if (step.type === 'condition') {
            const repeatCount = step.repeatCount ?? 1
            for (let repeatIndex = 1; repeatIndex <= repeatCount; repeatIndex++) {
              this.throwIfCancelled()
              const roundLabel = repeatCount > 1 ? ` · 第 ${repeatIndex}/${repeatCount} 次执行` : ''
              // 外层轮次进入截图文件名，避免每轮内部检查编号相同而覆盖前一轮结果。
              const screenshotPrefix = `step-${String(index + 1).padStart(3, '0')}${repeatCount > 1 ? `-run-${String(repeatIndex).padStart(3, '0')}` : ''}`
              if (roundLabel) await event('step', `第 ${number} 步：${stepSummary(step)}${roundLabel}`, index)
              try {
                await this.executeCondition(step, session, runDir, index, number, roundLabel, screenshotPrefix, event)
              } catch (error) {
                if (error instanceof CancelledError || !roundLabel) throw error
                throw new Error(`第 ${repeatIndex}/${repeatCount} 次执行失败：${error instanceof Error ? error.message : String(error)}`)
              }
            }
          } else if (step.type === 'listClick') {
            const result = await runListClick(step, session, () => this.throwIfCancelled(), async (name, reason) => {
              await event('warning', `第 ${number} 步：${name} 已跳过：${reason}`, index)
            })
            if (step.mode === 'rowState') {
              lists.hasRowState = true
              lists.rowSuccess += result.success
              lists.rowSkipped += result.skipped
            } else {
              lists.hasIdentity = true
              lists.identitySuccess += result.success
              lists.identitySkipped += result.skipped
              lists.identityDone += result.alreadyDone
            }
            await event('step', step.mode === 'rowState'
              ? `第 ${number} 步：成功点击 ${result.success} 次，跳过 ${result.skipped} 行次`
              : `第 ${number} 步：成功 ${result.success}，跳过 ${result.skipped}，原已完成 ${result.alreadyDone}`, index)
          } else {
            await this.executeBasicStep(step, session, runDir, `step-${String(index + 1).padStart(3, '0')}`)
          }
        } catch (error) {
          if (error instanceof CancelledError) throw error
          failedIndex = index
          // 流程卡包含自动启动应用，失败编号与目标必须按用户看到的流程呈现。
          throw new Error(`第 ${number} 步（${stepSummary(step)}）失败：${error instanceof Error ? error.message : String(error)}`)
        }
      }
      if (this.cancelled) throw new CancelledError()
      const summary = listSummary(lists)
      if (lists.rowSkipped + lists.identitySkipped) await event('partial', `任务部分完成：${summary}`)
      else await event('success', `任务执行成功${lists.hasRowState || lists.hasIdentity ? `：${summary}` : ''}`)
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

  /** 条件目标每轮只查一次；只有未命中且仍有机会时才执行不存在分支。 */
  private async executeCondition(
    step: ConditionStep,
    session: DeviceSessionPort,
    runDir: string,
    index: number,
    number: number,
    roundLabel: string,
    screenshotPrefix: string,
    event: (kind: RunEvent['kind'], message: string, stepIndex?: number) => Promise<void>
  ): Promise<void> {
    const maxChecks = step.mode === 'once' ? 1 : step.maxChecks
    for (let check = 1; check <= maxChecks; check++) {
      this.throwIfCancelled()
      const waitMs = step.mode === 'once' ? CONDITION_ONCE_WAIT_MS : 0
      const count = await session.count(step.selector, waitMs)
      this.throwIfCancelled()
      const waitDetail = waitMs > 0 ? `（最多等待 ${waitMs / 1000} 秒）` : ''
      await event('step', `第 ${number} 步：${stepSummary(step)}${roundLabel} · 第 ${check}/${maxChecks} 次检查${waitDetail}，匹配 ${count} 个控件`, index)
      if (!Number.isInteger(count) || count < 0) throw new Error('控件匹配数量无效')
      if (count > 1) throw new Error(`定位条件匹配 ${count} 个控件，需要恰好 1 个`)
      if (count === 1) {
        await this.executeBranch(step.whenPresent, '存在时', session, runDir, index, number, check, roundLabel, screenshotPrefix, event)
        return
      }
      if (step.mode === 'once') {
        await this.executeBranch(step.whenAbsent, '不存在时', session, runDir, index, number, check, roundLabel, screenshotPrefix, event)
        return
      }
      if (check === maxChecks) throw new Error(`连续检查 ${maxChecks} 次仍未找到控件：${step.selector.value}`)
      await this.executeBranch(step.whenAbsent, '不存在时', session, runDir, index, number, check, roundLabel, screenshotPrefix, event)
      await this.waitRetry(step.intervalMs)
    }
  }

  /** 分支动作沿用普通动作执行规则，并把分支位置写进日志与失败信息。 */
  private async executeBranch(
    actions: BasicStep[], label: string, session: DeviceSessionPort, runDir: string, index: number, number: number, check: number,
    roundLabel: string, screenshotPrefix: string,
    event: (kind: RunEvent['kind'], message: string, stepIndex?: number) => Promise<void>
  ): Promise<void> {
    await event('step', `第 ${number} 步${roundLabel}：执行「${label}」分支（${actions.length} 个动作）`, index)
    for (let childIndex = 0; childIndex < actions.length; childIndex++) {
      this.throwIfCancelled()
      const action = actions[childIndex]
      await event('step', `第 ${number} 步${roundLabel}「${label}」第 ${childIndex + 1} 个动作：${stepSummary(action)}`, index)
      try {
        // 轮次和分支写入文件名，重复查找中的截图不会覆盖前一轮。
        const screenshotName = `${screenshotPrefix}-${label === '存在时' ? 'present' : 'absent'}-${String(check).padStart(3, '0')}-${String(childIndex + 1).padStart(3, '0')}`
        await this.executeBasicStep(action, session, runDir, screenshotName)
      } catch (error) {
        if (error instanceof CancelledError) throw error
        throw new Error(`「${label}」分支第 ${childIndex + 1} 个动作（${stepSummary(action)}）失败：${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  /** 将重查等待切成短段，取消时不必等待完整的页面稳定时间。 */
  private async waitRetry(intervalMs: number): Promise<void> {
    const deadline = Date.now() + intervalMs
    while (Date.now() < deadline) {
      this.throwIfCancelled()
      await new Promise((resolve) => setTimeout(resolve, Math.min(100, deadline - Date.now())))
    }
    this.throwIfCancelled()
  }

  private throwIfCancelled(): void { if (this.cancelled) throw new CancelledError() }

  private async executeBasicStep(step: BasicStep, session: DeviceSessionPort, runDir: string, screenshotName: string): Promise<void> {
    const agent = session.agent()
    switch (step.type) {
      case 'tap':
        await agent.request('tap', { selector: step.selector, point: step.point, timeoutMs: step.timeoutMs }, step.timeoutMs + 3000)
        return
      case 'input':
        // 手机端写入后会核对并可能聚焦重试，网络等待须覆盖这段额外时间。
        await agent.request('input', { selector: step.selector, text: step.text, timeoutMs: step.timeoutMs }, step.timeoutMs + 6000)
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
        await writeFile(path.join(runDir, `${screenshotName}.png`), await session.screenshot())
        return
      case 'key':
        await agent.request('key', { key: step.key })
        return
    }
  }
}

class CancelledError extends Error {}
