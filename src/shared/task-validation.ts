/**
 * 任务输入校验：统一约束定位条件、普通动作及条件分支，防止导入与运行绕过限制。
 */
import type { AutomationTask, BasicStep, Selector, Step } from './types'

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
 * 校验完整任务及分支，导入、编辑提交与运行共用相同输入限制。
 * @param value 未信任的任务输入
 * @throws 字段无效、步骤超限或定位配置不合法时抛出中文错误
 */
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
    if ('hasRandomDelay' in step) {
      if (step.type !== 'tap' && step.type !== 'input' && step.type !== 'swipe') throw new Error('仅点击、输入和滑动支持随机停顿')
      if (typeof step.hasRandomDelay !== 'boolean') throw new Error('随机停顿必须为布尔值')
    }
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
      if (step.coordinateMode !== 'screenPercent' && step.coordinateMode !== 'elementPercent') throw new Error('滑动仅支持屏幕比例或控件内比例，请重新配置旧滑动步骤')
      validatePercent(step.from)
      validatePercent(step.to)
      if (step.from.x === step.to.x && step.from.y === step.to.y) throw new Error('滑动起点与终点不能相同')
      if (step.coordinateMode === 'elementPercent') {
        validateSelector(step.container, '滑动区域')
        validateTimeout(step.timeoutMs)
      } else if (step.container !== undefined || step.timeoutMs !== undefined) throw new Error('当前滑动模式不支持控件区域或查找超时')
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

/** 百分比允许小数，但拒绝字符串和非有限数值，避免手机端收到无效坐标。 */
function validatePercent(point: unknown): void {
  if (!point || typeof point !== 'object') throw new Error('滑动百分比坐标无效')
  const value = point as Record<string, unknown>
  if (![value.x, value.y].every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100)) {
    throw new Error('滑动百分比必须为 0–100 的有限数值')
  }
}

function validateTimeout(timeoutMs: number): void {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000) throw new Error('超时时间必须为 100–60000 毫秒')
}

