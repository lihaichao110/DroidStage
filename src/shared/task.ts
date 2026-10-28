/**
 * 任务与控件的纯逻辑：任务校验、控件定位建议、坐标换算与录制辅助文案。
 */
import type { AutomationTask, BasicStep, Bounds, ListClickDraft, ListClickStep, Selector, Step, UiNode } from './types'

const packagePattern = /^[A-Za-z_][\w]*(\.[A-Za-z_][\w]*)+$/
const selectorKinds = new Set(['resourceId', 'description', 'text', 'className'])

/** 列表步骤各定位字段的中文名：校验报错与编辑器共用一份，避免两处文案漂移。 */
export const listFieldLabels = {
  container: '滚动容器', row: '用户行', name: '显示名称', identity: '唯一标识',
  action: '待点击按钮', completed: '完成状态控件'
} as const

/**
 * 校验单个定位条件；传入字段名时报错会带上该名称并区分原因，便于用户定位是哪一项没配。
 * @param value 待校验的定位条件
 * @param label 字段中文名（如“用户行”），缺省时保持通用文案
 */
export function validateSelector(value: unknown, label?: string): asserts value is Selector {
  if (!value || typeof value !== 'object') throw new Error(label ? `缺少「${label}」控件定位条件` : '缺少控件定位条件')
  const selector = value as Record<string, unknown>
  const isKindValid = selectorKinds.has(String(selector.kind))
  const isValueFilled = typeof selector.value === 'string' && Boolean(selector.value.trim())
  if (label) {
    if (!isKindValid) throw new Error(`「${label}」定位方式无效`)
    if (!isValueFilled) throw new Error(`「${label}」定位值不能为空`)
  } else if (!isKindValid || !isValueFilled) {
    throw new Error('控件定位条件无效')
  }
  if (selector.matchIndex !== undefined && (!Number.isInteger(selector.matchIndex) || Number(selector.matchIndex) < 1 || Number(selector.matchIndex) > 10000)) {
    throw new Error(label ? `「${label}」匹配序号必须为 1–10000` : '匹配序号必须为 1–10000')
  }
}

/**
 * 草稿只序列化当前遍历模式需要的定位条件，避免隐藏字段阻碍校验。
 * @param id 步骤 ID
 * @param draft 编辑器草稿
 * @returns 与所选模式对应的任务步骤
 */
export function buildListStep(id: string, draft: ListClickDraft): ListClickStep {
  const common = { id, type: 'listClick' as const, container: draft.container, row: draft.row,
    action: draft.action, completed: draft.completed, maxScrolls: draft.maxScrolls, timeoutMs: draft.timeoutMs }
  return draft.mode === 'rowState'
    ? { ...common, mode: 'rowState', rowDepth: draft.rowDepth ?? 0 }
    : { ...common, mode: 'identity', name: draft.name, identity: draft.identity,
      ...(draft.rowDepth ? { rowDepth: draft.rowDepth } : {}) }
}

export function validateTask(value: unknown): asserts value is AutomationTask {
  if (!value || typeof value !== 'object') throw new Error('任务文件无效')
  const task = value as Record<string, unknown>
  if (task.version !== 1) throw new Error('不支持的任务版本')
  if (typeof task.name !== 'string' || !task.name.trim()) throw new Error('任务名称不能为空')
  // 包名可选：留空表示运行时不自动启动 App、直接在当前界面执行；一旦填写则必须合法，避免手误导致 monkey 启动失败
  const packageName = typeof task.packageName === 'string' ? task.packageName.trim() : ''
  if (packageName && !packagePattern.test(packageName)) throw new Error('App 包名无效')
  if (!Array.isArray(task.steps) || task.steps.length === 0 || task.steps.length > 500) throw new Error('任务须有 1–500 个步骤')
  const ids = new Set<string>()
  let totalSteps = 0
  /** 分支步骤也计入任务上限，避免用条件步骤绕过原有的 500 步限制。 */
  function registerStep(raw: unknown): asserts raw is Step {
    if (!raw || typeof raw !== 'object') throw new Error('步骤无效')
    const step = raw as Step
    if (typeof step.id !== 'string' || !step.id || ids.has(step.id)) throw new Error('步骤 ID 无效或重复')
    ids.add(step.id)
    totalSteps++
    if (totalSteps > 500) throw new Error('任务须有 1–500 个步骤')
  }
  for (const raw of task.steps) {
    registerStep(raw)
    const step = raw as Step
    if (step.type === 'listClick') {
      if (step.mode !== undefined && step.mode !== 'identity' && step.mode !== 'rowState') throw new Error('列表遍历模式无效')
      for (const field of ['container', 'row', 'action', 'completed'] as const) validateSelector(step[field], listFieldLabels[field])
      for (const field of ['row', 'action', 'completed'] as const) {
        if (step[field].matchIndex !== undefined) throw new Error('列表行内定位不能使用全屏匹配序号')
      }
      if (step.mode === 'rowState') {
        if (!Number.isInteger(step.rowDepth) || step.rowDepth < 1 || step.rowDepth > 20) throw new Error('用户行层级必须为 1–20')
      } else {
        validateSelector(step.name, listFieldLabels.name)
        validateSelector(step.identity, listFieldLabels.identity)
        for (const field of ['name', 'identity'] as const) {
          if (step[field].matchIndex !== undefined) throw new Error('列表行内定位不能使用全屏匹配序号')
        }
        if (step.rowDepth !== undefined && (!Number.isInteger(step.rowDepth) || step.rowDepth < 1 || step.rowDepth > 20)) throw new Error('用户行层级必须为 1–20')
      }
      if (!Number.isInteger(step.maxScrolls) || step.maxScrolls < 1 || step.maxScrolls > 1000) throw new Error('最多滚动次数必须为 1–1000')
      validateTimeout(step.timeoutMs)
    } else if (step.type === 'condition') {
      validateSelector(step.selector)
      if (step.repeatCount !== undefined && (!Number.isInteger(step.repeatCount) || step.repeatCount < 1 || step.repeatCount > 100)) {
        throw new Error('重复执行次数必须为 1–100 次')
      }
      if (step.mode !== 'once' && step.mode !== 'repeatUntilPresent') throw new Error('条件判断模式无效')
      if (!Array.isArray(step.whenPresent) || !Array.isArray(step.whenAbsent)) throw new Error('条件分支无效')
      if (step.mode === 'repeatUntilPresent') {
        if (!Number.isInteger(step.maxChecks) || step.maxChecks < 1 || step.maxChecks > 100) throw new Error('检查次数必须为 1–100 次')
        validateTimeout(step.intervalMs)
      }
      for (const branch of [step.whenPresent, step.whenAbsent]) {
        for (const child of branch) {
          registerStep(child)
          const branchStep = child as Step
          if (branchStep.type === 'condition' || branchStep.type === 'listClick') throw new Error('条件分支暂不支持嵌套步骤')
          validateBasicStep(branchStep)
        }
      }
    } else {
      validateBasicStep(step)
    }
  }
}

/** 校验可直接执行的动作；条件分支与顶层步骤共用同一组参数约束。 */
function validateBasicStep(step: BasicStep): void {
  switch (step.type) {
    case 'tap':
      if (Boolean(step.selector) === Boolean(step.point)) throw new Error('点击步骤必须指定控件或坐标')
      if (step.selector) validateSelector(step.selector)
      if (step.point) validatePoint(step.point)
      validateTimeout(step.timeoutMs)
      break
    case 'input':
      validateSelector(step.selector)
      if (typeof step.text !== 'string') throw new Error('输入文本无效')
      validateTimeout(step.timeoutMs)
      break
    case 'swipe':
      validatePoint(step.from)
      validatePoint(step.to)
      if (!Number.isInteger(step.durationMs) || step.durationMs < 100 || step.durationMs > 10000) throw new Error('滑动时长无效')
      break
    case 'wait':
      validateSelector(step.selector)
      if (typeof step.exists !== 'boolean') throw new Error('等待条件无效')
      validateTimeout(step.timeoutMs)
      break
    case 'assert':
      validateSelector(step.selector)
      if (typeof step.exists !== 'boolean') throw new Error('断言条件无效')
      break
    case 'screenshot':
      break
    case 'key':
      if (step.key !== 'back' && step.key !== 'home') throw new Error('按键无效')
      break
    default:
      throw new Error('未知步骤类型')
  }
}

function validatePoint(point: unknown): void {
  if (!point || typeof point !== 'object') throw new Error('坐标无效')
  const value = point as Record<string, unknown>
  if (![value.x, value.y].every((v) => Number.isInteger(v) && Number(v) >= 0 && Number(v) <= 10000)) throw new Error('坐标无效')
}

function validateTimeout(timeoutMs: number): void {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000) throw new Error('超时时间必须为 100–60000 毫秒')
}

const stepTitles: Record<Step['type'], string> = {
  tap: '点击控件', input: '输入文本', swipe: '滑动屏幕', wait: '等待控件', assert: '断言控件',
  condition: '条件判断', listClick: '遍历列表并点击', screenshot: '保存截图', key: '按下按键'
}

const selectorNames: Record<Selector['kind'], string> = {
  resourceId: '资源 ID', description: '描述', text: '文字', className: '类名'
}

/** 步骤类型下拉选项：名称与任务流程卡、运行记录完全一致，避免同一动作出现多种叫法。 */
export const stepTypeOptions: { value: Step['type']; label: string }[] = [
  { value: 'tap', label: stepTitles.tap },
  { value: 'input', label: stepTitles.input },
  { value: 'swipe', label: stepTitles.swipe },
  { value: 'wait', label: stepTitles.wait },
  { value: 'assert', label: stepTitles.assert },
  { value: 'condition', label: stepTitles.condition },
  { value: 'listClick', label: stepTitles.listClick },
  { value: 'screenshot', label: stepTitles.screenshot },
  { value: 'key', label: stepTitles.key }
]

/** 返回任务流程卡与运行记录共用的动作名称。 */
export function stepTitle(type: Step['type']): string { return stepTitles[type] }

/** 返回任务流程卡与运行记录共用的目标摘要。 */
export function stepDetail(step: Step): string {
  const target = (selector: Selector): string => `${selectorNames[selector.kind]}：${selector.value}${selector.matchIndex ? ` · 第 ${selector.matchIndex} 个` : ''}`
  switch (step.type) {
    case 'tap': return step.selector ? target(step.selector) : `坐标 (${step.point?.x}, ${step.point?.y})`
    case 'input': return `${target(step.selector)} · ${step.text.length} 字`
    case 'swipe': return `(${step.from.x}, ${step.from.y}) → (${step.to.x}, ${step.to.y})`
    case 'wait': return `${target(step.selector)} · ${step.exists ? '出现' : '消失'}`
    case 'assert': return `${target(step.selector)} · ${step.exists ? '存在' : '不存在'}`
    case 'condition': return `${target(step.selector)} · ${step.mode === 'once' ? '判断一次' : `最多检查 ${step.maxChecks} 次`}`
    case 'listClick': return `${step.mode === 'rowState' ? '按行状态' : '按唯一标识'} · 行：${target(step.row)} · 点击：${target(step.action)} · 最多滚动 ${step.maxScrolls} 次`
    case 'screenshot': return '当前设备画面'
    case 'key': return step.key === 'back' ? '返回' : 'Home'
  }
}

/** 将动作名称和目标合成运行记录所需的一行摘要。 */
export function stepSummary(step: Step): string { return `${stepTitle(step.type)} · ${stepDetail(step)}` }

/** 自动打开应用在流程卡中占第一步；内部 stepIndex 仍保持任务数组下标。 */
export function flowStepNumber(index: number, packageName?: string): number { return index + 1 + Number(Boolean(packageName)) }

/**
 * 生成“控件不属于目标 App”的录制警告文案。
 * 任务运行时会先自动启动目标 App，录制时选中的其他应用控件（典型是桌面图标）届时不在屏幕上，将无法定位。
 * 任务未指定包名时不告警：运行时不会切走应用，当前屏幕上的控件届时仍然有效。
 * @param nodePackageName 选中控件所属应用的包名（控件树的 package 属性）
 * @param taskPackageName 任务目标 App 包名，留空表示运行时不启动 App
 * @returns 需要警告时返回提示文案，否则返回 null
 */
export function crossAppWarning(nodePackageName: string | undefined, taskPackageName: string | undefined): string | null {
  if (!nodePackageName || !taskPackageName || nodePackageName === taskPackageName) return null
  return `注意：该控件属于「${nodePackageName}」而非目标 App「${taskPackageName}」。任务运行时会先自动启动目标 App，桌面图标等当前屏幕上的外部控件届时无法定位，请确认此步骤是否必要`
}

/**
 * 从当前快照建议可唯一定位的属性；可点击控件优先使用语义描述，减少动态资源 ID 失效。
 * @param node 当前选中的控件
 * @param nodes 当前快照的全部控件，用于判断描述是否唯一
 * @returns 建议的定位条件；无可用属性时返回 null
 */
export function suggestedSelector(node: UiNode, nodes: readonly UiNode[]): Selector | null {
  if (node.clickable && node.description.trim() && nodes.filter((candidate) => candidate.description === node.description).length === 1) {
    return { kind: 'description', value: node.description }
  }
  for (const [kind, value] of [['resourceId', node.resourceId], ['description', node.description], ['text', node.text], ['className', node.className]] as const) {
    if (!value) continue
    const matches = sortedMatches(nodes.filter((candidate) => candidate[kind] === value))
    const index = matches.findIndex((candidate) => candidate.id === node.id)
    if (index < 0 || !indexedMatchIsDistinct(matches.map((candidate) => candidate.bounds), index + 1)) continue
    return { kind, value, ...(matches.length > 1 ? { matchIndex: index + 1 } : {}) }
  }
  return null
}

/**
 * 从当前层级确认示例行属于指定容器，并记录相对层级以排除同类名嵌套控件。
 * @param container 已选滚动容器定位条件
 * @param row 用户选中的示例行
 * @param nodes 当前屏控件树
 * @returns 示例行相对容器的层级
 * @throws 容器或示例行无法唯一定位时抛出
 */
export function deriveRowDepth(container: Selector, row: UiNode, nodes: readonly UiNode[]): number {
  const candidates = sortedMatches(nodes.filter((node) => node[container.kind] === container.value))
  const parent = container.matchIndex ? candidates[container.matchIndex - 1] : candidates.length === 1 ? candidates[0] : null
  if (!parent) throw new Error('滚动容器未唯一定位；请先拾取容器或指定匹配序号')
  if (!row.id.startsWith(`${parent.id}.`)) throw new Error('所选用户行不在滚动容器内')
  const depth = row.depth - parent.depth
  if (!Number.isInteger(depth) || depth < 1 || depth > 20) throw new Error('用户行层级必须为 1–20')
  return depth
}

/**
 * 为示例行选择可覆盖同层其它行的定位条件，避免把单人专属资源 ID 当成整列模板。
 * @param container 已选滚动容器定位条件
 * @param row 用户选中的示例行
 * @param nodes 当前屏控件树
 * @returns 可用于整列用户行的定位条件
 * @throws 容器、行或其定位属性无效时抛出
 */
export function suggestedRowSelector(container: Selector, row: UiNode, nodes: readonly UiNode[]): Selector {
  deriveRowDepth(container, row, nodes)
  const candidates = sortedMatches(nodes.filter((node) => node[container.kind] === container.value))
  const parent = container.matchIndex ? candidates[container.matchIndex - 1] : candidates[0]
  const peers = nodes.filter((node) => node.depth === row.depth && node.id.startsWith(`${parent.id}.`))
  if (row.resourceId && peers.filter((peer) => peer.resourceId === row.resourceId).length > 1) {
    return { kind: 'resourceId', value: row.resourceId }
  }
  if (row.className) return { kind: 'className', value: row.className }
  if (row.resourceId) return { kind: 'resourceId', value: row.resourceId }
  throw new Error('所选用户行没有可用于遍历的类名或资源 ID')
}

/** 按屏幕几何顺序排序；完全相同的边界无法可靠指定序号。 */
export function sortedMatches<T extends { bounds: Bounds }>(nodes: readonly T[]): T[] {
  return [...nodes].sort((a, b) => a.bounds.top - b.bounds.top || a.bounds.left - b.bounds.left || a.bounds.bottom - b.bounds.bottom || a.bounds.right - b.bounds.right)
}

/** 判断指定序号是否存在且有可区分的屏幕位置。 */
export function indexedMatchIsDistinct(bounds: readonly Bounds[], index: number): boolean {
  const target = bounds[index - 1]
  return Boolean(target && !bounds.some((other, position) => position !== index - 1 && other.top === target.top && other.left === target.left && other.right === target.right && other.bottom === target.bottom))
}

export function findNodeAt(nodes: UiNode[], x: number, y: number): UiNode | null {
  const hits = nodes.filter((node) => x >= node.bounds.left && x < node.bounds.right && y >= node.bounds.top && y < node.bounds.bottom)
  hits.sort((a, b) => {
    const areaA = (a.bounds.right - a.bounds.left) * (a.bounds.bottom - a.bounds.top)
    const areaB = (b.bounds.right - b.bounds.left) * (b.bounds.bottom - b.bounds.top)
    return areaA - areaB || b.depth - a.depth
  })
  return hits[0] ?? null
}

export function mapClientToScreen(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }, width: number, height: number): { x: number; y: number } {
  if (rect.width <= 0 || rect.height <= 0 || width <= 0 || height <= 0) throw new Error('截图尺寸无效')
  return {
    x: Math.max(0, Math.min(width - 1, Math.floor((clientX - rect.left) * width / rect.width))),
    y: Math.max(0, Math.min(height - 1, Math.floor((clientY - rect.top) * height / rect.height)))
  }
}

/**
 * 把控件的屏幕像素 bounds 换算为截图叠加层上的像素矩形（以截图所在滚动容器为坐标原点）。
 * 截图按等比缩放显示，用截图元素的实际渲染宽度求出统一缩放比例；结果夹取在截图范围内，
 * 防止异常 bounds 的高亮框撑出滚动区。
 * @param bounds 控件在屏幕上的像素边界
 * @param imageRect 截图元素相对滚动容器的位置与其显示宽度（像素）
 * @param width 截图像素宽
 * @param height 截图像素高
 * @returns 叠加层上的像素矩形
 * @throws 截图尺寸非正时抛出
 */
export function mapScreenToRect(bounds: Bounds, imageRect: { left: number; top: number; width: number }, width: number, height: number): { left: number; top: number; width: number; height: number } {
  if (width <= 0 || height <= 0 || imageRect.width <= 0) throw new Error('截图尺寸无效')
  const scale = imageRect.width / width
  const imageLeft = imageRect.left
  const imageTop = imageRect.top
  const clampX = (value: number): number => Math.max(imageLeft, Math.min(imageLeft + imageRect.width, value))
  const clampY = (value: number): number => Math.max(imageTop, Math.min(imageTop + imageRect.width * height / width, value))
  const left = clampX(imageLeft + bounds.left * scale)
  const top = clampY(imageTop + bounds.top * scale)
  const right = clampX(imageLeft + bounds.right * scale)
  const bottom = clampY(imageTop + bounds.bottom * scale)
  return { left, top, width: right - left, height: bottom - top }
}
