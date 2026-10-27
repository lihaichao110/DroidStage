/**
 * 任务格式与控件定位纯逻辑测试。
 */
import { describe, expect, it } from 'vitest'
import { crossAppWarning, findNodeAt, flowStepNumber, indexedMatchIsDistinct, mapClientToScreen, mapScreenToRect, stepDetail, stepSummary, stepTitle, stepTypeOptions, suggestedSelector, validateTask } from '../src/shared/task'
import { parseHierarchy } from '../src/main/hierarchy'

const node = {
  id: '0', depth: 0, text: '登录', resourceId: 'com.example:id/login', description: '',
  className: 'android.widget.Button', packageName: 'com.example', clickable: true,
  bounds: { left: 10, top: 20, right: 110, bottom: 80 }
}

describe('任务格式', () => {
  it('接受完整的基础流程', () => {
    const task = { version: 1, name: '登录', packageName: 'com.example.app', steps: [
      { id: 'a', type: 'input', selector: { kind: 'resourceId', value: 'com.example:id/name' }, text: '中文', timeoutMs: 10000 },
      { id: 'b', type: 'tap', selector: { kind: 'text', value: '登录' }, timeoutMs: 10000 },
      { id: 'c', type: 'assert', selector: { kind: 'text', value: '欢迎' }, exists: true }
    ] }
    expect(() => validateTask(task)).not.toThrow()
  })

  it('包名可留空：缺失或空串均通过校验，填写则仍必须合法', () => {
    const steps = [{ id: 'a', type: 'screenshot' }]
    expect(() => validateTask({ version: 1, name: 'x', steps })).not.toThrow()
    expect(() => validateTask({ version: 1, name: 'x', packageName: '', steps })).not.toThrow()
    expect(() => validateTask({ version: 1, name: 'x', packageName: 'bad', steps })).toThrow('App 包名无效')
  })

  it('拒绝重复 ID、不合法包名和同时指定两种点击目标', () => {
    expect(() => validateTask({ version: 1, name: 'x', packageName: 'bad', steps: [] })).toThrow()
    expect(() => validateTask({ version: 1, name: 'x', packageName: 'a.b', steps: [] })).toThrow()
    expect(() => validateTask({ version: 1, name: 'x', packageName: 'a.b', steps: [
      { id: 'a', type: 'screenshot' }, { id: 'a', type: 'screenshot' }
    ] })).toThrow()
    expect(() => validateTask({ version: 1, name: 'x', packageName: 'a.b', steps: [
      { id: 'a', type: 'tap', selector: { kind: 'text', value: 'x' }, point: { x: 1, y: 1 }, timeoutMs: 1000 }
    ] })).toThrow()
  })

  it('兼容旧版任务，并接受空分支及手填的当前不存在目标', () => {
    const steps = [
      { id: 'old', type: 'assert', selector: { kind: 'text', value: '旧步骤' }, exists: false },
      { id: 'condition', type: 'condition', selector: { kind: 'text', value: '关注' }, mode: 'repeatUntilPresent', maxChecks: 20, intervalMs: 1000,
        whenPresent: [], whenAbsent: [{ id: 'swipe', type: 'swipe', from: { x: 300, y: 700 }, to: { x: 300, y: 300 }, durationMs: 500 }] }
    ]
    const task = { version: 1, name: '找关注按钮', steps }
    expect(() => validateTask(task)).not.toThrow()
    expect(() => validateTask(JSON.parse(JSON.stringify(task)))).not.toThrow()
  })

  it('允许选第 2 个匹配项，并拒绝无效序号与不合法列表参数', () => {
    const selector = { kind: 'text', value: '搜索', matchIndex: 2 }
    expect(() => validateTask({ version: 1, name: 'x', steps: [{ id: 'a', type: 'tap', selector, timeoutMs: 1000 }] })).not.toThrow()
    expect(() => validateTask({ version: 1, name: 'x', steps: [{ id: 'a', type: 'tap', selector: { ...selector, matchIndex: 0 }, timeoutMs: 1000 }] })).toThrow('匹配序号')
    const list = { id: 'list', type: 'listClick', container: selector, row: { kind: 'className', value: 'Row' },
      name: { kind: 'text', value: '名称' }, identity: { kind: 'resourceId', value: 'id/name' },
      action: { kind: 'text', value: '关注' }, completed: { kind: 'text', value: '已关注' }, maxScrolls: 100, timeoutMs: 1000 }
    const wrap = (step: unknown) => ({ version: 1, name: 'x', steps: [step] })
    expect(() => validateTask(wrap(list))).not.toThrow()
    expect(() => validateTask(wrap({ ...list, maxScrolls: 1001 }))).toThrow('最多滚动次数')
    expect(() => validateTask(wrap({ ...list, name: selector }))).toThrow('行内定位')
  })

  it('条件步骤的重复执行次数可省略，填写时须为 1–100 的整数', () => {
    const base = { id: 'condition', type: 'condition', selector: { kind: 'text', value: '关注' }, mode: 'once', whenPresent: [], whenAbsent: [] }
    const wrap = (step: unknown) => ({ version: 1, name: '重复校验', steps: [step] })
    for (const count of [undefined, 1, 10, 100]) {
      expect(() => validateTask(wrap({ ...base, repeatCount: count }))).not.toThrow()
    }
    for (const count of [0, -1, 101, 1.5, '10', '', null, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => validateTask(wrap({ ...base, repeatCount: count }))).toThrow('重复执行次数必须为 1–100 次')
    }
  })

  it('条件参数、嵌套、重复 ID 和累计 500 步上限均受校验', () => {
    const base = { id: 'condition', type: 'condition', selector: { kind: 'text', value: '关注' }, mode: 'repeatUntilPresent', maxChecks: 20, intervalMs: 1000, whenPresent: [], whenAbsent: [] }
    const wrap = (step: unknown) => ({ version: 1, name: '测试', steps: [step] })
    expect(() => validateTask(wrap({ ...base, maxChecks: 101 }))).toThrow('检查次数')
    expect(() => validateTask(wrap({ ...base, intervalMs: 99 }))).toThrow('超时时间')
    expect(() => validateTask(wrap({ ...base, whenAbsent: [{ ...base, id: 'nested' }] }))).toThrow('暂不支持嵌套')
    expect(() => validateTask(wrap({ ...base, whenAbsent: [{ id: 'condition', type: 'screenshot' }] }))).toThrow('重复')
    expect(() => validateTask(wrap({ ...base, whenAbsent: Array.from({ length: 500 }, (_, index) => ({ id: `shot-${index}`, type: 'screenshot' })) }))).toThrow('1–500')
  })
})

describe('页面控件定位', () => {
  it('按屏幕顺序选中下方控件，目标减少或位置重合时拒绝序号', () => {
    const upper = { ...node, id: 'upper', text: '搜索', bounds: { left: 0, top: 20, right: 100, bottom: 60 } }
    const lower = { ...upper, id: 'lower', bounds: { left: 0, top: 200, right: 100, bottom: 240 } }
    expect(suggestedSelector(lower, [lower, upper])).toEqual({ kind: 'resourceId', value: node.resourceId, matchIndex: 2 })
    expect(indexedMatchIsDistinct([upper.bounds, lower.bounds], 2)).toBe(true)
    expect(indexedMatchIsDistinct([upper.bounds], 2)).toBe(false)
    expect(indexedMatchIsDistinct([upper.bounds, upper.bounds], 2)).toBe(false)
    const overlap = { ...lower, id: 'overlap', resourceId: upper.resourceId }
    expect(suggestedSelector(lower, [upper, lower, overlap])).toBeNull()
  })
  it('可点击控件的描述唯一时优先推荐描述，并选中点击坐标处最小控件', () => {
    const root = { ...node, id: 'root', bounds: { left: 0, top: 0, right: 200, bottom: 200 } }
    expect(suggestedSelector({ ...node, description: '登录' }, [root, { ...node, description: '登录' }]))
      .toEqual({ kind: 'description', value: '登录' })
    expect(findNodeAt([root, node], 40, 40)?.id).toBe('0')
  })

  it('重复描述、无描述或不可点击时沿用资源 ID', () => {
    const described = { ...node, description: '关注' }
    expect(suggestedSelector(described, [described, { ...described, id: 'other', bounds: { left: 10, top: 100, right: 110, bottom: 160 } }]))
      .toEqual({ kind: 'resourceId', value: 'com.example:id/login', matchIndex: 1 })
    expect(suggestedSelector(node, [node])).toEqual({ kind: 'resourceId', value: 'com.example:id/login' })
    expect(suggestedSelector({ ...described, clickable: false }, [{ ...described, clickable: false }]))
      .toEqual({ kind: 'resourceId', value: 'com.example:id/login' })
  })

  it('解析 UI Automator 的 XML 与 bounds', () => {
    const xml = '<hierarchy rotation="0"><node text="" bounds="[0,0][200,200]" class="root"><node text="登录" resource-id="com.example:id/login" content-desc="" class="android.widget.Button" package="com.example" clickable="true" bounds="[10,20][110,80]"/></node></hierarchy>'
    const nodes = parseHierarchy(xml)
    expect(nodes).toHaveLength(2)
    expect(nodes[1].text).toBe('登录')
    expect(nodes[1].bounds).toEqual(node.bounds)
  })

  it('按实际截图比例映射点击坐标，支持不同分辨率和旋转后的截图', () => {
    expect(mapClientToScreen(150, 125, { left: 50, top: 25, width: 200, height: 200 }, 1080, 2400)).toEqual({ x: 540, y: 1200 })
    expect(mapClientToScreen(250, 225, { left: 50, top: 25, width: 200, height: 200 }, 2400, 1080)).toEqual({ x: 2399, y: 1079 })
  })

  it('把控件 bounds 换算为截图叠加层的像素矩形，越界部分夹取在截图内', () => {
    // 截图 1080x2400 显示宽 540（缩放 0.5），图片在滚动容器内偏移 (50, 10)
    expect(mapScreenToRect({ left: 10, top: 20, right: 110, bottom: 80 }, { left: 50, top: 10, width: 540 }, 1080, 2400))
      .toEqual({ left: 55, top: 20, width: 50, height: 30 })
    // 右边界超出截图的异常 bounds 被夹到图片右缘
    expect(mapScreenToRect({ left: 1000, top: 0, right: 1200, bottom: 100 }, { left: 50, top: 10, width: 540 }, 1080, 2400))
      .toEqual({ left: 550, top: 10, width: 40, height: 50 })
    expect(() => mapScreenToRect(node.bounds, { left: 0, top: 0, width: 0 }, 1080, 2400)).toThrow()
  })
})

describe('录制辅助', () => {
  it('控件不属于目标 App（如桌面图标）时返回警告，同应用或信息不足时不警告', () => {
    const warning = crossAppWarning('com.miui.home', 'com.example.app')
    expect(warning).toContain('com.miui.home')
    expect(warning).toContain('com.example.app')
    expect(crossAppWarning('com.example.app', 'com.example.app')).toBeNull()
    expect(crossAppWarning(undefined, 'com.example.app')).toBeNull()
    expect(crossAppWarning('com.example', '')).toBeNull()
    // 任务未指定包名 = 运行时不切走应用，当前屏幕控件届时仍有效，无需警告
    expect(crossAppWarning('com.miui.home', undefined)).toBeNull()
  })

  it('步骤类型下拉选项与流程卡、运行记录使用同一套名称', () => {
    expect(stepTypeOptions.map((option) => option.label)).toEqual(['点击控件', '输入文本', '滑动屏幕', '等待控件', '断言控件', '条件判断', '遍历列表并点击', '保存截图', '按下按键'])
    expect(stepTypeOptions.every((option) => option.label === stepTitle(option.value))).toBe(true)
  })

  it('流程卡与运行记录共用动作、目标摘要和包含启动步骤的编号', () => {
    const tap = { id: 'tap', type: 'tap' as const, selector: { kind: 'description' as const, value: '抖音' }, timeoutMs: 1000 }
    expect(stepTitle(tap.type)).toBe('点击控件')
    expect(stepDetail(tap)).toBe('描述：抖音')
    expect(stepSummary(tap)).toBe('点击控件 · 描述：抖音')
    expect(stepSummary({ id: 'point', type: 'tap', point: { x: 10, y: 20 }, timeoutMs: 1000 })).toBe('点击控件 · 坐标 (10, 20)')
    expect(stepSummary({ id: 'condition', type: 'condition', selector: { kind: 'resourceId', value: 'app:id/button' }, mode: 'once', whenPresent: [], whenAbsent: [] }))
      .toBe('条件判断 · 资源 ID：app:id/button · 判断一次')
    expect(flowStepNumber(0, 'com.example.app')).toBe(2)
    expect(flowStepNumber(0)).toBe(1)
  })
})
