/**
 * 检视区双面板：左栏「手机画面」实时投屏全高展示（操控/拾取双模式），
 * 中栏「当前选择」详情 + 控件树；悬浮联动状态在此持有，画面与树两个来源共用同一份。
 */
import { useEffect, useState } from 'react'
import type { HierarchySnapshot, Point, Selector, UiNode } from '../../../shared/types'
import { ElementDetails } from './element-details'
import { HierarchyTree } from './hierarchy-tree'
import { ScreenMirror, type MirrorMode } from './screen-mirror'

// 空快照时的稳定引用：内联 ?? [] 每次渲染都是新数组，会触发树的重置 effect 无限循环
const NO_NODES: UiNode[] = []

type InspectorPanelProps = {
  snapshot: HierarchySnapshot | null
  selectedNode: UiNode | null
  selectedPoint: Point | null
  selector: Selector | null
  isConnected: boolean
  isBusy: boolean
  isTaskRunning: boolean
  onRefresh: () => void
  onSelect: (node: UiNode | null, point: Point | null) => void
  onSelectorChange: (selector: Selector | null) => void
}

export function InspectorPanel({ snapshot, selectedNode, selectedPoint, selector, isConnected, isBusy, isTaskRunning, onRefresh, onSelect, onSelectorChange }: InspectorPanelProps) {
  const [hoverNode, setHoverNode] = useState<UiNode | null>(null)
  const [mode, setMode] = useState<MirrorMode>('control')

  // 新快照后旧悬浮节点指向的 bounds 已过期，清掉避免在新画面上画出错位高亮
  useEffect(() => { setHoverNode(null) }, [snapshot])

  // Fragment 输出两个面板，正好填入 workspace 网格的前两列，任务编辑占第三列
  return <>
    <section className="panel inspector inspector-shot">
      <div className="panel-head">
        <h2>手机画面</h2>
        <div className="panel-tools">
          <div className="mode-switch" role="group" aria-label="鼠标模式">
            <button className={mode === 'control' ? 'active' : ''} onClick={() => setMode('control')} disabled={!isConnected}>操控</button>
            <button className={mode === 'inspect' ? 'active' : ''} onClick={() => setMode('inspect')} disabled={!isConnected}>拾取</button>
          </div>
          <button onClick={onRefresh} disabled={!isConnected || isBusy}>刷新层级</button>
        </div>
      </div>
      <ScreenMirror
        snapshot={snapshot}
        selectedNode={selectedNode}
        hoverNode={hoverNode}
        isConnected={isConnected}
        isBusy={isBusy}
        isTaskRunning={isTaskRunning}
        mode={mode}
        onPick={onSelect}
        onHoverNode={setHoverNode}
        onRefresh={onRefresh}
      />
    </section>
    <section className="panel inspector inspector-side">
      <ElementDetails node={selectedNode} selector={selector} selectedPoint={selectedPoint} isConnected={isConnected} onSelectorChange={onSelectorChange} />
      <HierarchyTree nodes={snapshot?.nodes ?? NO_NODES} selectedId={selectedNode?.id ?? null} hoverNode={hoverNode} onSelect={onSelect} onHoverNode={setHoverNode} />
    </section>
  </>
}
