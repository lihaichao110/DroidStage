/**
 * 主进程与渲染进程共用的任务、设备、事件和 IPC 类型。
 */
export type Selector = { kind: 'resourceId' | 'description' | 'text' | 'className'; value: string; matchIndex?: number }
export type Point = { x: number; y: number }
export type Bounds = { left: number; top: number; right: number; bottom: number }

export type BasicStep =
  | { id: string; type: 'tap'; selector?: Selector; point?: Point; timeoutMs: number }
  | { id: string; type: 'input'; selector: Selector; text: string; timeoutMs: number }
  | { id: string; type: 'swipe'; from: Point; to: Point; durationMs: number }
  | { id: string; type: 'wait'; selector: Selector; exists: boolean; timeoutMs: number }
  | { id: string; type: 'assert'; selector: Selector; exists: boolean }
  | { id: string; type: 'screenshot' }
  | { id: string; type: 'key'; key: 'back' | 'home' }

export type ConditionStep = {
  id: string
  type: 'condition'
  selector: Selector
  /** 整个条件步骤的执行次数；旧任务缺省时按 1 次处理。 */
  repeatCount?: number
  whenPresent: BasicStep[]
  whenAbsent: BasicStep[]
} & (
  | { mode: 'once' }
  | { mode: 'repeatUntilPresent'; maxChecks: number; intervalMs: number }
)

/** 在同一个滚动容器中逐行执行动作，行内字段均相对于用户行查找。 */
export type ListClickStep = {
  id: string
  type: 'listClick'
  container: Selector
  row: Selector
  name: Selector
  identity: Selector
  action: Selector
  completed: Selector
  maxScrolls: number
  timeoutMs: number
}

export type Step = BasicStep | ConditionStep | ListClickStep

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
  scrollable: boolean
  bounds: Bounds
}

/** 层级快照：控件树 + 当前方向屏幕尺寸；实时画面由投屏通道承载，不再随快照内嵌图片。 */
export type HierarchySnapshot = { nodes: UiNode[]; width: number; height: number; capturedAt: string }

/**
 * 投屏触摸事件：操控模式下由鼠标手势映射生成，主进程校验后编码为 scrcpy 控制消息。
 * 坐标为视频帧坐标（scrcpy 控制协议的坐标空间，server 端自行换算到物理屏）。
 * move 携带点序列：拖拽时鼠标高频移动在渲染端按帧合并，控制通道逐点写入。
 */
export type TouchInput =
  | { action: 'down' | 'up' | 'cancel'; x: number; y: number; frameWidth: number; frameHeight: number }
  | { action: 'move'; points: Point[]; frameWidth: number; frameHeight: number }

/** 滚轮输入：dy 为滚轮格数（可带小数，来自触控板平滑滚动），正值为向下滚。 */
export type ScrollInput = { x: number; y: number; frameWidth: number; frameHeight: number; dy: number }

/** 投屏状态：starting 拉起中、streaming 推流中、stopped 已停止、error 启动或运行中断。 */
export type MirrorStatus =
  | { state: 'starting' }
  | { state: 'streaming' }
  | { state: 'stopped' }
  | { state: 'error'; message: string }

export type RunEvent = {
  kind: 'start' | 'step' | 'warning' | 'success' | 'partial' | 'failure' | 'cancelled'
  at: string
  stepIndex?: number
  message: string
  runDir?: string
  batchId?: string
  serial?: string
}

/** 主进程持有的逐设备连接态，供页面重载后恢复。 */
export type SessionState = { serial: string; connected: boolean }

export type DeviceRunStatus = 'pending' | 'running' | 'success' | 'partial' | 'failure' | 'cancelled'
export type ListRow = { name: string; key: string; hasAction: boolean; hasCompleted: boolean; error?: string }
export type MatchInfo = { bounds: Bounds; index: number }
export type DeviceRun = { serial: string; status: DeviceRunStatus; stepIndex?: number; error?: string; runDir?: string }
export type BatchRecord = {
  id: string
  taskName: string
  startedAt: string
  finishedAt?: string
  devices: DeviceRun[]
  events: RunEvent[]
}

export type AppApi = {
  listDevices(): Promise<Device[]>
  pairWireless(address: string, code: string): Promise<void>
  connectWireless(address: string): Promise<void>
  enableLegacyWireless(serial: string, ip: string): Promise<{ serial: string; sdk: number }>
  connect(serial: string): Promise<void>
  disconnect(serial: string): Promise<void>
  sessionStates(): Promise<SessionState[]>
  snapshot(serial: string): Promise<HierarchySnapshot>
  count(serial: string, selector: Selector): Promise<number>
  inspectMatches(serial: string, selector: Selector): Promise<MatchInfo[]>
  saveTask(task: AutomationTask): Promise<string | null>
  loadTask(): Promise<AutomationTask | null>
  runTask(task: AutomationTask, serials: string[]): Promise<BatchRecord>
  cancelRun(serial?: string): Promise<void>
  batchState(): Promise<BatchRecord | null>
  listBatches(): Promise<BatchRecord[]>
  openRunDir(directory: string): Promise<void>
  onRunEvent(listener: (event: RunEvent) => void): () => void
  startMirroring(serial: string, quality: 'editor' | 'wall'): Promise<void>
  stopMirroring(serial: string): Promise<void>
  sendTouch(serial: string, event: TouchInput): Promise<void>
  sendScroll(serial: string, input: ScrollInput): Promise<void>
  sendKey(serial: string, key: 'back' | 'home'): Promise<void>
  /** 订阅投屏流起始：meta 携带设备物理分辨率，其后视频字节经 onMirrorChunk 连续下发。 */
  onMirrorStream(listener: (item: { serial: string; physicalWidth: number; physicalHeight: number }) => void): () => void
  /** 订阅投屏视频字节（连续的 H.264 流，按 socket 分块送达）。 */
  onMirrorChunk(listener: (item: { serial: string; bytes: Uint8Array }) => void): () => void
  onMirrorStatus(listener: (item: { serial: string; status: MirrorStatus }) => void): () => void
}
