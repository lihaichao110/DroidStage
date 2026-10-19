/**
 * 投屏 Hook：订阅主进程经 IPC 下发的视频字节流，经解码管线绘制到 canvas；
 * 操控模式下把鼠标手势（按下/拖拽/滚轮/右键返回）换算为设备坐标后下发注入。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { MirrorStatus } from '../../../shared/types'
import { mapClientToScreen } from '../../../shared/task'
import { currentDeviceSize, frameToPoint, type Size } from '../../../shared/touch'
import { VideoPipeline } from '../utils/video-pipeline'

export function useScreenMirror(isConnected: boolean, interactive: boolean) {
  const api = window.androidAutoDesk
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState<MirrorStatus>({ state: 'stopped' })
  const [frameSize, setFrameSize] = useState<Size | null>(null)
  // 指针/滚轮回调需要读取最新值，全部走 ref，避免 React 闭包拿到过期状态
  const frameSizeRef = useRef<Size | null>(null)
  const physicalRef = useRef<Size | null>(null)
  const interactiveRef = useRef(interactive)
  const pipelineRef = useRef<VideoPipeline | null>(null)
  const draggingRef = useRef(false)
  const movesRef = useRef<{ x: number; y: number }[]>([])
  const rafRef = useRef(0)

  useEffect(() => { interactiveRef.current = interactive }, [interactive])

  /** 解码输出：画到 canvas 后立刻释放 VideoFrame（不持有引用，降低显存占用）。 */
  const drawFrame = (frame: VideoFrame): void => {
    const canvas = canvasRef.current
    if (canvas) {
      if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
        canvas.width = frame.displayWidth
        canvas.height = frame.displayHeight
        frameSizeRef.current = { width: frame.displayWidth, height: frame.displayHeight }
        setFrameSize(frameSizeRef.current)
      }
      canvas.getContext('2d')?.drawImage(frame, 0, 0)
    }
    frame.close()
  }

  /** 新建解码管线：看门狗会把「无数据/解析不出帧/解码无输出」都转成明确错误。 */
  const createPipeline = (): VideoPipeline => new VideoPipeline({
    onFrame: drawFrame,
    onError: (message) => setStatus({ state: 'error', message })
  })

  // 连接后自动开启投屏；断开或卸载时停止并释放管线
  useEffect(() => {
    if (!isConnected) return
    setStatus({ state: 'starting' })
    pipelineRef.current = createPipeline()
    const offStatus = api.onMirrorStatus(setStatus)
    const offStream = api.onMirrorStream((meta) => {
      physicalRef.current = { width: meta.physicalWidth, height: meta.physicalHeight }
      // 新流（重试/重连）从 IDR 开始：管线连同看门狗、解码器一并重置
      pipelineRef.current?.dispose()
      pipelineRef.current = createPipeline()
    })
    const offChunk = api.onMirrorChunk((bytes) => pipelineRef.current?.feed(bytes))
    void api.startMirroring().catch((error) => setStatus({ state: 'error', message: error instanceof Error ? error.message : String(error) }))
    return () => {
      offStatus()
      offStream()
      offChunk()
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      draggingRef.current = false
      movesRef.current = []
      pipelineRef.current?.dispose()
      pipelineRef.current = null
      physicalRef.current = null
      frameSizeRef.current = null
      setFrameSize(null)
      void api.stopMirroring()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- drawFrame 只引用 ref 与稳定的 setter
  }, [isConnected])

  /** 手动注入失败不致命（下一次手势即可重试），仅告警不弹错误浮层。 */
  const touchError = (error: unknown): void => { console.warn('触摸注入失败', error) }

  /** 客户端坐标 → 设备屏幕坐标；画面未就绪时返回 null。 */
  const clientToDevice = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
    const canvas = canvasRef.current
    const frame = frameSizeRef.current
    const physical = physicalRef.current
    if (!canvas || !frame || !physical) return null
    try {
      const rect = canvas.getBoundingClientRect()
      const inFrame = mapClientToScreen(clientX, clientY, rect, frame.width, frame.height)
      return frameToPoint(inFrame.x, inFrame.y, frame, currentDeviceSize(physical, frame))
    } catch {
      return null
    }
  }, [])

  /** 按显示帧率把积压的轨迹点合并成一次 move 请求，抵消 adb 每请求往返延迟。 */
  const flushMoves = (): void => {
    rafRef.current = 0
    const points = movesRef.current
    if (!points.length || !draggingRef.current) return
    movesRef.current = []
    void api.sendTouch({ action: 'move', points }).catch(touchError)
  }

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!interactiveRef.current || event.button !== 0) return
    const point = clientToDevice(event.clientX, event.clientY)
    if (!point) return
    event.currentTarget.setPointerCapture(event.pointerId)
    draggingRef.current = true
    movesRef.current = []
    void api.sendTouch({ action: 'down', x: point.x, y: point.y }).catch(touchError)
  }, [clientToDevice])

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!draggingRef.current) return
    const point = clientToDevice(event.clientX, event.clientY)
    if (!point) return
    movesRef.current.push(point)
    if (!rafRef.current) rafRef.current = requestAnimationFrame(flushMoves)
  }, [clientToDevice])

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!draggingRef.current) return
    draggingRef.current = false
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0 }
    const points = movesRef.current
    movesRef.current = []
    // 先补发未合并的轨迹再抬手，保证拖拽轨迹完整
    if (points.length) void api.sendTouch({ action: 'move', points }).catch(touchError)
    const point = clientToDevice(event.clientX, event.clientY) ?? points[points.length - 1]
    if (point) void api.sendTouch({ action: 'up', x: point.x, y: point.y }).catch(touchError)
  }, [clientToDevice])

  const onPointerCancel = useCallback((event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!draggingRef.current) return
    draggingRef.current = false
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0 }
    const points = movesRef.current
    movesRef.current = []
    const point = clientToDevice(event.clientX, event.clientY) ?? points[points.length - 1]
    if (point) void api.sendTouch({ action: 'cancel', x: point.x, y: point.y }).catch(touchError)
  }, [clientToDevice])

  // 滚轮与右键需要 preventDefault，React 合成事件挂在根节点且 wheel 为 passive，必须用原生监听
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (event: WheelEvent): void => {
      if (!interactiveRef.current) return
      event.preventDefault()
      const point = clientToDevice(event.clientX, event.clientY)
      if (point) void api.sendScroll({ x: point.x, y: point.y, dy: Math.max(-1000, Math.min(1000, event.deltaY)) }).catch(touchError)
    }
    const onContextMenu = (event: MouseEvent): void => {
      if (!interactiveRef.current) return
      event.preventDefault()
      void api.sendKey('back').catch(touchError)
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('contextmenu', onContextMenu)
    return () => {
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('contextmenu', onContextMenu)
    }
  }, [clientToDevice])

  /** 出错后手动重试：主进程 start 会先停旧实例再交付新端口。 */
  const restart = useCallback(() => {
    setStatus({ state: 'starting' })
    void api.startMirroring().catch((error) => setStatus({ state: 'error', message: error instanceof Error ? error.message : String(error) }))
  }, [])

  return { canvasRef, status, frameSize, restart, clientToDevice, pointerHandlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel } }
}
