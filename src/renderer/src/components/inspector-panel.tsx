/**
 * 设备预览面板：展示实时投屏并提供操控、拾取与层级刷新入口。
 */
import { useState } from 'react'
import type { HierarchySnapshot, Point, UiNode } from '../../../shared/types'
import { ScreenMirror, type MirrorMode } from './screen-mirror'

type InspectorPanelProps = {
  serial: string
  snapshot: HierarchySnapshot | null
  selectedNode: UiNode | null
  hoverNode: UiNode | null
  isConnected: boolean
  isBusy: boolean
  isTaskRunning: boolean
  isSubmitting: boolean
  onRefresh: () => void
  onSelect: (node: UiNode | null, point: Point | null) => void
  onHoverNode: (node: UiNode | null) => void
}

/**
 * 让投屏占据独立栏位，拾取结果仍由上层传给右侧元素详情。
 * @param props 投屏状态及拾取回调
 * @returns 设备预览面板
 */
export function InspectorPanel({ serial, snapshot, selectedNode, hoverNode, isConnected, isBusy, isTaskRunning, isSubmitting, onRefresh, onSelect, onHoverNode }: InspectorPanelProps) {
  const [mode, setMode] = useState<MirrorMode>('control')

  return <section className="panel device-panel" inert={isSubmitting}>
    <div className="panel-head device-head">
      <h2>设备预览</h2>
      <button className="icon-action" title="刷新控件层级" aria-label="刷新控件层级" onClick={onRefresh} disabled={!isConnected || isBusy || isTaskRunning}>↻</button>
    </div>
    <ScreenMirror
      serial={serial}
      snapshot={snapshot}
      selectedNode={selectedNode}
      hoverNode={hoverNode}
      isConnected={isConnected}
      isBusy={isBusy}
      isTaskRunning={isTaskRunning}
      mode={mode}
      onPick={onSelect}
      onHoverNode={onHoverNode}
      onRefresh={onRefresh}
    />
    <div className="device-foot">
      <div className="mode-switch" role="group" aria-label="鼠标模式">
        <button className={mode === 'inspect' ? 'active' : ''} onClick={() => setMode('inspect')} disabled={!isConnected}>◎ <span>拾取元素</span></button>
        <button className={mode === 'control' ? 'active' : ''} onClick={() => setMode('control')} disabled={!isConnected}>↗ <span>操控设备</span></button>
      </div>
    </div>
  </section>
}
