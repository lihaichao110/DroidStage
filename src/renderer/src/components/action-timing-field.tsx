/**
 * 动作时间配置：在时间标签同行提供独立随机停顿开关，供普通步骤和条件分支复用。
 */
import { useId } from 'react'
import './action-timing-field.css'

type ActionTimingFieldProps = {
  label: string
  value: number
  max: number
  onChange: (value: number) => void
  hasRandomDelay?: boolean
  onRandomDelayChange?: (checked: boolean) => void
  className?: string
}

/**
 * 保持时间输入和开关各自可访问，避免嵌套标签导致点击开关误聚焦时间输入。
 * @param props 时间参数与可选的随机停顿配置；不传回调时仅显示时间输入
 * @returns 可换行的时间表单行及启用说明
 */
export function ActionTimingField(props: ActionTimingFieldProps) {
  const id = useId()
  const hintId = `${id}-hint`
  return <div className={`setting-field action-timing-field ${props.className ?? ''}`}>
    <div className="action-timing-head">
      <label htmlFor={id}>{props.label}</label>
      {props.onRandomDelayChange && <label className="action-timing-toggle">
        <input type="checkbox" checked={props.hasRandomDelay ?? false} aria-describedby={props.hasRandomDelay ? hintId : undefined}
          onChange={(event) => props.onRandomDelayChange?.(event.target.checked)} />随机停顿
      </label>}
    </div>
    <input id={id} type="number" min="100" max={props.max} value={props.value} onChange={(event) => props.onChange(Number(event.target.value))} />
    {props.onRandomDelayChange && props.hasRandomDelay && <p id={hintId} className="action-timing-hint">每次动作前随机停顿 50–200ms，不改变超时或滑动时长。</p>}
  </div>
}
