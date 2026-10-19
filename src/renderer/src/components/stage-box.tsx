/**
 * 画面高亮框：把控件在设备屏幕上的 bounds 换算为画面容器内的像素矩形并绝对定位。
 * 关闭 pointer-events，让鼠标事件仍落在下方的画面（canvas）上。
 */
import type { Bounds } from '../../../shared/types'
import { mapScreenToRect } from '../../../shared/task'

/** 画面元素相对滚动容器的位置与显示宽度（ResizeObserver 实时量测）。 */
export type StageBox = { left: number; top: number; width: number }

export function HighlightBox({ kind, bounds, width, height, stageBox }: {
  kind: 'preview' | 'selected'
  bounds: Bounds
  width: number
  height: number
  stageBox: StageBox
}): React.JSX.Element {
  const rect = mapScreenToRect(bounds, stageBox, width, height)
  return <div className={`stage-box ${kind}`} style={{ left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` }} />
}
