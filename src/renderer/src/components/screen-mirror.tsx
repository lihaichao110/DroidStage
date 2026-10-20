/**
 * 投屏舞台：实时画面 canvas + 状态浮层。操控模式下鼠标手势由 Hook 下发注入；
 * 拾取模式复用原截图检视的命中与高亮交互——层级 bounds 基于设备屏幕坐标，
 * 与当前投屏帧同向等比，可直接映射到画面上叠加。
 */
import { useEffect, useRef, useState } from 'react'
import type { HierarchySnapshot, UiNode } from '../../../shared/types'
import { findNodeAt } from '../../../shared/task'
import { useScreenMirror } from '../hooks/use-screen-mirror'
import { HighlightBox, type StageBox } from './stage-box'

export type MirrorMode = 'control' | 'inspect'

type ScreenMirrorProps = {
  serial: string
  snapshot: HierarchySnapshot | null
  selectedNode: UiNode | null
  hoverNode: UiNode | null
  isConnected: boolean
  isBusy: boolean
  isTaskRunning: boolean
  mode: MirrorMode
  onPick: (node: UiNode | null, point: { x: number; y: number }) => void
  onHoverNode: (node: UiNode | null) => void
  onRefresh: () => void
}

// 快照与投屏帧宽高比差异超过 2% 视为旋转后层级过期
const STALE_ASPECT = 0.02

export function ScreenMirror({ serial, snapshot, selectedNode, hoverNode, isConnected, isBusy, isTaskRunning, mode, onPick, onHoverNode, onRefresh }: ScreenMirrorProps) {
  const interactive = mode === 'control' && !isTaskRunning
  const { canvasRef, status, frameSize, restart, clientToDevice, pointerHandlers } = useScreenMirror(serial, isConnected, interactive)
  const [stageBox, setStageBox] = useState<StageBox | null>(null)
  const staleNotified = useRef(false)

  // 高亮框要贴着 canvas 实际渲染位置：窗口缩放与旋转都会改变其尺寸，持续量测
  useEffect(() => {
    const canvas = canvasRef.current
    const stage = canvas?.closest('.image-stage')
    if (!canvas || !stage) return
    const measure = () => {
      const canvasRect = canvas.getBoundingClientRect()
      const stageRect = stage.getBoundingClientRect()
      setStageBox({ left: canvasRect.left - stageRect.left, top: canvasRect.top - stageRect.top, width: canvasRect.width })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [canvasRef, frameSize])

  // 快照与当前帧方向不一致说明旋转后未刷新，拾取模式下自动刷新一次；任务运行中连接被步骤占用，不自动触发
  const isStale = Boolean(snapshot && frameSize && Math.abs(snapshot.width / snapshot.height - frameSize.width / frameSize.height) > STALE_ASPECT)
  useEffect(() => {
    if (mode !== 'inspect' || !isStale || isBusy || isTaskRunning || staleNotified.current) return
    staleNotified.current = true
    onRefresh()
  }, [mode, isStale, isBusy, onRefresh])
  useEffect(() => { if (!isStale) staleNotified.current = false }, [isStale])

  /** 拾取模式：画面点击/悬浮换算到设备坐标后按最小面积命中控件。 */
  function pickAt(clientX: number, clientY: number): void {
    if (!snapshot) return
    const point = clientToDevice(clientX, clientY)
    if (point) onPick(findNodeAt(snapshot.nodes, point.x, point.y), point)
  }

  function hoverAt(clientX: number, clientY: number): void {
    if (!snapshot) return
    const point = clientToDevice(clientX, clientY)
    if (point) onHoverNode(findNodeAt(snapshot.nodes, point.x, point.y))
  }

  // 预览框与选中框重叠时只画选中框，避免视觉噪音（仅拾取模式叠加）
  const previewNode = mode === 'inspect' && hoverNode && hoverNode.id !== selectedNode?.id ? hoverNode : null
  const canOverlay = mode === 'inspect' && Boolean(snapshot && stageBox)

  return <div className="image-stage mirror">
    {isConnected && <canvas
      ref={canvasRef}
      className={interactive ? 'control' : 'inspect'}
      {...pointerHandlers}
      onClick={(event) => mode === 'inspect' && pickAt(event.clientX, event.clientY)}
      onMouseMove={(event) => mode === 'inspect' && hoverAt(event.clientX, event.clientY)}
      onMouseLeave={() => mode === 'inspect' && onHoverNode(null)}
    />}
    {!isConnected && <div className="empty">连接手机后显示实时画面</div>}
    {isConnected && status.state === 'starting' && <div className="mirror-overlay">正在建立投屏…</div>}
    {isConnected && (status.state === 'error' || status.state === 'stopped') && (
      <div className={`mirror-overlay${status.state === 'error' ? ' error' : ''}`}>
        <span>{status.state === 'error' ? status.message : '投屏已停止'}</span>
        <button onClick={restart}>重新投屏</button>
      </div>
    )}
    {mode === 'inspect' && isStale && !isBusy && <div className="mirror-badge">画面已旋转，正在刷新层级…</div>}
    {isTaskRunning && mode === 'control' && <div className="mirror-badge">任务运行中，手动操控已暂停</div>}
    {canOverlay && previewNode && <HighlightBox kind="preview" bounds={previewNode.bounds} width={snapshot!.width} height={snapshot!.height} stageBox={stageBox!} />}
    {canOverlay && selectedNode && <HighlightBox kind="selected" bounds={selectedNode.bounds} width={snapshot!.width} height={snapshot!.height} stageBox={stageBox!} />}
  </div>
}
