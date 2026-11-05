/**
 * 比例滑动输入校验测试：阻止旧像素格式、无效百分比和非法区域配置进入执行器。
 */
import { describe, expect, it } from 'vitest'
import { validateTask } from '../src/shared/task-validation'

const swipe = { id: 's', type: 'swipe', coordinateMode: 'screenPercent', from: { x: 0, y: 100 }, to: { x: 100, y: 0 }, durationMs: 500 }
const task = (step: unknown) => ({ version: 1, name: '校验', steps: [step] })

describe('比例滑动输入', () => {
  it('接受两个端点和有限小数', () => {
    expect(() => validateTask(task(swipe))).not.toThrow()
    expect(() => validateTask(task({ ...swipe, from: { x: 50.25, y: 80.75 } }))).not.toThrow()
  })

  it.each([undefined, 'pixel', 'unknown', null])('拒绝旧坐标或未知模式 %s', (coordinateMode) => {
    expect(() => validateTask(task({ ...swipe, coordinateMode }))).toThrow('请重新配置旧滑动步骤')
  })

  it.each([-1, 100.001, NaN, Infinity, '50', null, undefined])('拒绝非法百分比 %s', (x) => {
    expect(() => validateTask(task({ ...swipe, from: { x, y: 20 } }))).toThrow('百分比')
    expect(() => validateTask(task({ ...swipe, to: { x: 20, y: x } }))).toThrow('百分比')
  })

  it('拒绝缺失点和相同起终点', () => {
    expect(() => validateTask(task({ ...swipe, from: null }))).toThrow('坐标无效')
    expect(() => validateTask(task({ ...swipe, to: swipe.from }))).toThrow('不能相同')
  })

  it('屏幕比例不接受控件区域或查找超时字段', () => {
    expect(() => validateTask(task({ ...swipe, container: { kind: 'text', value: '列表' } }))).toThrow('不支持控件区域')
    expect(() => validateTask(task({ ...swipe, timeoutMs: 10000 }))).toThrow('不支持控件区域')
  })

  it('控件内比例必须配置有效定位条件与超时', () => {
    const element = { ...swipe, coordinateMode: 'elementPercent', container: { kind: 'resourceId', value: 'list', matchIndex: 2 }, timeoutMs: 10000 }
    expect(() => validateTask(task(element))).not.toThrow()
    expect(() => validateTask(task({ ...element, container: undefined }))).toThrow('滑动区域')
    expect(() => validateTask(task({ ...element, container: { ...element.container, matchIndex: 0 } }))).toThrow('匹配序号')
    for (const timeoutMs of [undefined, 99, 60001, 500.5]) {
      expect(() => validateTask(task({ ...element, timeoutMs }))).toThrow('超时时间')
    }
  })

  it.each([99, 10001, 500.5])('保持时长限制 %s', (durationMs) => {
    expect(() => validateTask(task({ ...swipe, durationMs }))).toThrow('滑动时长')
  })

  it('条件分支执行相同的比例校验', () => {
    expect(() => validateTask(task({ id: 'c', type: 'condition', mode: 'once', selector: { kind: 'text', value: '目标' },
      whenPresent: [], whenAbsent: [{ ...swipe, from: { x: 300, y: 700 } }] }))).toThrow('百分比')
  })
})
