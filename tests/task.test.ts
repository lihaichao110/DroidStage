import { describe, expect, it } from 'vitest'
import { crossAppWarning, findNodeAt, mapClientToScreen, mapScreenToRect, stepTypeName, suggestedSelector, validateTask } from '../src/shared/task'
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
})

describe('页面控件定位', () => {
  it('优先生成资源 ID，并选中点击坐标处最小控件', () => {
    const root = { ...node, id: 'root', bounds: { left: 0, top: 0, right: 200, bottom: 200 } }
    expect(suggestedSelector(node)).toEqual({ kind: 'resourceId', value: 'com.example:id/login' })
    expect(findNodeAt([root, node], 40, 40)?.id).toBe('0')
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

  it('步骤类型有对应的中文动作名', () => {
    expect(stepTypeName('tap')).toBe('点击')
    expect(stepTypeName('input')).toBe('输入文本')
    expect(stepTypeName('swipe')).toBe('滑动')
    expect(stepTypeName('wait')).toBe('等待控件')
    expect(stepTypeName('assert')).toBe('断言控件')
    expect(stepTypeName('screenshot')).toBe('保存截图')
    expect(stepTypeName('key')).toBe('按键')
  })
})
