/**
 * 滑动参数编辑器：为普通步骤与条件分支提供一致的起终点、坐标模式和区域定位。
 */
import type { Point, Selector } from '../../../shared/types'
import type { SwipeDraft } from '../utils/swipe-draft'
import { ActionTimingField } from './action-timing-field'
import './swipe-editor.css'

type SwipeEditorProps = {
  value: SwipeDraft
  hasRandomDelay: boolean
  onRandomDelayChange: (checked: boolean) => void
  onChange: (value: SwipeDraft) => void
  pickedSelector?: Selector | null
}

/**
 * 编辑独立区域定位，不改变点击或条件判断所用的目标。
 * @param props 滑动草稿、更新回调与当前拾取定位
 * @returns 两种比例模式共用的参数表单
 */
export function SwipeEditor({ value, onChange, pickedSelector, hasRandomDelay, onRandomDelayChange }: SwipeEditorProps) {
  const { from, to } = value
  const change = (patch: Partial<SwipeDraft>): void => onChange({ ...value, ...patch })
  const selector = value.container
  return <div className="swipe-editor">
    <label className="setting-field">滑动方式<select value={value.coordinateMode} onChange={(event) => change({ coordinateMode: event.target.value as SwipeDraft['coordinateMode'] })}>
      <option value="screenPercent">屏幕比例（推荐）</option>
      <option value="elementPercent">控件内比例</option>
    </select></label>
    {value.coordinateMode === 'elementPercent' && <div className="branch-target">
      <strong>滑动区域</strong>
      <div className="branch-target-shortcuts">
        <button type="button" disabled={!pickedSelector?.value} onClick={() => change({ container: pickedSelector ? { ...pickedSelector } : null })}>使用当前拾取目标</button>
      </div>
      <label className="setting-field">定位方式<select value={selector?.kind ?? 'resourceId'} onChange={(event) => change({ container: { kind: event.target.value as Selector['kind'], value: selector?.value ?? '', ...(selector?.matchIndex ? { matchIndex: selector.matchIndex } : {}) } })}>
        <option value="resourceId">资源 ID</option><option value="description">描述</option><option value="text">文字</option><option value="className">类名</option>
      </select></label>
      <label className="setting-field">定位值<input value={selector?.value ?? ''} onChange={(event) => change({ container: { ...selector, kind: selector?.kind ?? 'resourceId', value: event.target.value } })} /></label>
      <label className="setting-field">匹配序号（可选，从 1 开始）<input type="number" min="1" max="10000" step="1" value={selector?.matchIndex ?? ''} onChange={(event) => {
        const { matchIndex: _index, ...base } = selector ?? { kind: 'resourceId' as const, value: '' }
        change({ container: { ...base, ...(event.target.value === '' ? {} : { matchIndex: Number(event.target.value) }) } })
      }} /></label>
      <label className="setting-field">查找超时（毫秒）<input type="number" min="100" max="60000" value={value.timeoutMs} onChange={(event) => change({ timeoutMs: Number(event.target.value) })} /></label>
    </div>}
    <div className="swipe-grid">
      <SwipePoint label="起点" point={from} onChange={(point) => change({ from: point })} />
      <SwipePoint label="终点" point={to} onChange={(point) => change({ to: point })} />
      <ActionTimingField className="span-two" label="滑动时长（毫秒）" value={value.durationMs} max={10000}
        onChange={(durationMs) => change({ durationMs })} hasRandomDelay={hasRandomDelay} onRandomDelayChange={onRandomDelayChange} />
    </div>
    <p className="swipe-hint">{value.coordinateMode === 'screenPercent'
      ? '以当前手机完整屏幕为基准，包含系统栏；局部列表建议使用控件内比例。'
      : '每次执行时重新定位控件，在其屏幕内可见区域滑动；找不到目标会报错。'}手指从起点滑向终点；X 向右增大，Y 向下增大。滑过的内容条数可能因手机而异。</p>
  </div>
}

/** 在标签中明确单位，百分比允许小数且两端边界均可填写。 */
function SwipePoint({ label, point, onChange }: { label: string; point: Point; onChange: (point: Point) => void }) {
  return <>{(['x', 'y'] as const).map((axis) => <label className="setting-field" key={axis}>{label} {axis.toUpperCase()}（%）
    <input type="number" min="0" max="100" step="any" value={point[axis]} onChange={(event) => onChange({ ...point, [axis]: Number(event.target.value) })} />
  </label>)}</>
}
