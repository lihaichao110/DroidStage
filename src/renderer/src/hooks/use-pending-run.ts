/**
 * 运行准备编排：等待首要设备投屏出画面（mirror:status=streaming）后才下发任务，
 * 保证工作台首帧先于手机执行；投屏失败/超时不阻塞自动化，明确提示后照常运行。
 */
import { useEffect, useRef, useState } from 'react'
import type { BatchSummary, PendingRun } from '../../../shared/types'

// 覆盖投屏建流全链路的兜底上限：wm size 最多 5s + push/forward + 编码器冷启动 2~3s
const GATE_TIMEOUT_MS = 10_000

type PendingRunGate = {
  onLaunched: (batch: BatchSummary) => void
  onLaunchFailed: (message: string) => void
  onNotice: (message: string) => void
}

/**
 * 监听准备态：首要设备画面就绪（或失败/超时/断开）时下发任务。
 * @param pendingRun 准备中的任务；null 时不做任何事
 * @param connectedSerials 当前已连接设备，用于首要设备断开时的即时放行
 * @param gate 结果回调：成功、下发失败、照常运行提示
 * @returns 是否已进入任务下发（准备横幅据此禁用取消按钮）
 */
export function usePendingRun(pendingRun: PendingRun | null, connectedSerials: string[], gate: PendingRunGate): boolean {
  const api = window.androidAutoDesk
  const [isLaunching, setLaunching] = useState(false)
  // 连接列表与回调经 ref 读取最新值，避免其身份变化重建等待、重置超时
  const connectedRef = useRef(connectedSerials)
  connectedRef.current = connectedSerials
  const gateRef = useRef(gate)
  gateRef.current = gate
  // 已下发过的准备实例：effect 因重渲染重建时不得对同一实例重复下发任务
  const launchedRef = useRef<PendingRun | null>(null)

  useEffect(() => {
    if (!pendingRun) { setLaunching(false); return }
    if (launchedRef.current === pendingRun) return
    setLaunching(false)
    const { task, targets, primary } = pendingRun
    let cancelled = false
    let timer = 0

    /** 下发任务；notice 说明未等画面就绪就照常运行的原因。 */
    const launch = (notice?: string): void => {
      if (launchedRef.current === pendingRun) return
      launchedRef.current = pendingRun
      setLaunching(true)
      if (timer) window.clearTimeout(timer)
      if (notice) gateRef.current.onNotice(notice)
      api.runTask(task, targets)
        .then((batch) => { if (!cancelled) gateRef.current.onLaunched(batch) })
        // 下发失败必须显式报错并退出准备态，不允许静默停留在等待中
        .catch((error) => { if (!cancelled) gateRef.current.onLaunchFailed(error instanceof Error ? error.message : String(error)) })
    }

    // 首要设备已断开则投屏永远等不来，立即照常运行（批次对离线设备会显式报错）
    if (!connectedRef.current.includes(primary)) {
      launch(`首要设备 ${primary} 已断开，任务照常开始。`)
      return
    }
    const offStatus = api.onMirrorStatus((item) => {
      if (item.serial !== primary) return
      if (item.status.state === 'streaming') launch()
      // 编码器已明确失败，继续等只会白等满超时
      else if (item.status.state === 'error') launch(`首要设备投屏失败：${item.status.message}，任务照常开始。`)
    })
    timer = window.setTimeout(() => launch('投屏 10 秒内未就绪，任务已照常开始。'), GATE_TIMEOUT_MS)
    return () => { cancelled = true; offStatus(); if (timer) window.clearTimeout(timer) }
  }, [pendingRun, api])

  return isLaunching
}
