/**
 * 任务所需设备能力：ADB 代理与手机端直连会话共用此接口。
 */
import type { HierarchySnapshot, Selector } from '../shared/types'

export type AgentPort = {
  request<T>(op: string, args?: Record<string, unknown>, timeoutMs?: number): Promise<T>
  count(selector: Selector, waitMs?: number): Promise<number>
}

export type DeviceSessionPort = {
  readonly serial: string
  agent(): AgentPort
  isAlive(): boolean
  count(selector: Selector, waitMs?: number): Promise<number>
  screenshot(): Promise<Buffer>
  snapshot(): Promise<HierarchySnapshot>
  launch(packageName: string): Promise<void>
  close(): Promise<void>
}
