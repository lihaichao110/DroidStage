/**
 * 任务与控件的纯逻辑：任务校验、控件定位建议、坐标换算与录制辅助文案。
 */
import type { AutomationTask, BasicStep, Bounds, Selector, Step, UiNode } from './types'

const packagePattern = /^[A-Za-z_][\w]*(\.[A-Za-z_][\w]*)+$/
const selectorKinds = new Set(['resourceId', 'description', 'text', 'className'])

export function validateSelector(value: unknown): asserts value is Selector {
  if (!value || typeof value !== 'object') throw new Error('缺少控件定位条件')
  const selector = value as Record<string, unknown>
  if (!selectorKinds.has(String(selector.kind)) || typeof selector.value !== 'string' || !selector.value.trim()) {
    throw new Error('控件定位条件无效')
  }
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
    if (step.type === 'condition') {
      validateSelector(step.selector)
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
          if (branchStep.type === 'condition') throw new Error('条件分支暂不支持嵌套条件判断')
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
  condition: '条件判断', screenshot: '保存截图', key: '按下按键'
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
  { value: 'screenshot', label: stepTitles.screenshot },
  { value: 'key', label: stepTitles.key }
]

/** 返回任务流程卡与运行记录共用的动作名称。 */
export function stepTitle(type: Step['type']): string { return stepTitles[type] }

/** 返回任务流程卡与运行记录共用的目标摘要。 */
export function stepDetail(step: Step): string {
  const target = (selector: Selector): string => `${selectorNames[selector.kind]}：${selector.value}`
  switch (step.type) {
    case 'tap': return step.selector ? target(step.selector) : `坐标 (${step.point?.x}, ${step.point?.y})`
    case 'input': return `${target(step.selector)} · ${step.text.length} 字`
    case 'swipe': return `(${step.from.x}, ${step.from.y}) → (${step.to.x}, ${step.to.y})`
    case 'wait': return `${target(step.selector)} · ${step.exists ? '出现' : '消失'}`
    case 'assert': return `${target(step.selector)} · ${step.exists ? '存在' : '不存在'}`
    case 'condition': return `${target(step.selector)} · ${step.mode === 'once' ? '判断一次' : `最多检查 ${step.maxChecks} 次`}`
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
  if (node.resourceId) return { kind: 'resourceId', value: node.resourceId }
  if (node.description) return { kind: 'description', value: node.description }
  if (node.text) return { kind: 'text', value: node.text }
  if (node.className) return { kind: 'className', value: node.className }
  return null
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
