export type Selector = { kind: 'resourceId' | 'description' | 'text' | 'className'; value: string }
export type Point = { x: number; y: number }
export type Bounds = { left: number; top: number; right: number; bottom: number }

export type Step =
  | { id: string; type: 'tap'; selector?: Selector; point?: Point; timeoutMs: number }
  | { id: string; type: 'input'; selector: Selector; text: string; timeoutMs: number }
  | { id: string; type: 'swipe'; from: Point; to: Point; durationMs: number }
  | { id: string; type: 'wait'; selector: Selector; exists: boolean; timeoutMs: number }
  | { id: string; type: 'assert'; selector: Selector; exists: boolean }
  | { id: string; type: 'screenshot' }
  | { id: string; type: 'key'; key: 'back' | 'home' }

export type AutomationTask = {
  version: 1
  name: string
  /** 目标 App 包名：留空表示运行时不自动启动 App，步骤直接作用于手机当前界面。 */
  packageName?: string
  steps: Step[]
}

export type Device = { serial: string; state: string; model?: string; usb: boolean }

export type UiNode = {
  id: string
  depth: number
  text: string
  resourceId: string
  description: string
  className: string
  packageName: string
  clickable: boolean
  bounds: Bounds
}

/** 层级快照：控件树 + 当前方向屏幕尺寸；实时画面由投屏通道承载，不再随快照内嵌图片。 */
export type HierarchySnapshot = { nodes: UiNode[]; width: number; height: number; capturedAt: string }

/**
 * 投屏触摸事件：操控模式下由鼠标手势映射生成，主进程转发给 agent 注入。
 * move 携带点序列：拖拽时鼠标高频移动在渲染端按帧合并，降低 adb 往返次数。
 */
export type TouchInput =
  | { action: 'down'; x: number; y: number }
  | { action: 'move'; points: Point[] }
  | { action: 'up' | 'cancel'; x: number; y: number }

/** 投屏状态：starting 拉起中、streaming 推流中、stopped 已停止、error 启动或运行中断。 */
export type MirrorStatus =
  | { state: 'starting' }
  | { state: 'streaming' }
  | { state: 'stopped' }
  | { state: 'error'; message: string }

export type RunEvent = {
  kind: 'start' | 'step' | 'success' | 'failure' | 'cancelled'
  at: string
  stepIndex?: number
  message: string
  runDir?: string
}

/** 主进程持有的连接态：渲染进程重载（dev HMR/手动刷新）后据此恢复界面。 */
export type SessionState = { connected: boolean; serial: string | null }

export type AppApi = {
  listDevices(): Promise<Device[]>
  connect(serial: string): Promise<void>
  disconnect(): Promise<void>
  sessionState(): Promise<SessionState>
  snapshot(): Promise<HierarchySnapshot>
  count(selector: Selector): Promise<number>
  saveTask(task: AutomationTask): Promise<string | null>
  loadTask(): Promise<AutomationTask | null>
  runTask(task: AutomationTask): Promise<void>
  cancelRun(): Promise<void>
  openRunDir(directory: string): Promise<void>
  onRunEvent(listener: (event: RunEvent) => void): () => void
  startMirroring(): Promise<void>
  stopMirroring(): Promise<void>
  sendTouch(event: TouchInput): Promise<void>
  sendScroll(input: { x: number; y: number; dy: number }): Promise<void>
  sendKey(key: 'back' | 'home'): Promise<void>
  /** 订阅投屏流起始：meta 携带设备物理分辨率，其后视频字节经 onMirrorChunk 连续下发。 */
  onMirrorStream(listener: (meta: { physicalWidth: number; physicalHeight: number }) => void): () => void
  /** 订阅投屏视频字节（连续的 H.264 流，按 socket 分块送达）。 */
  onMirrorChunk(listener: (bytes: Uint8Array) => void): () => void
  onMirrorStatus(listener: (status: MirrorStatus) => void): () => void
}
