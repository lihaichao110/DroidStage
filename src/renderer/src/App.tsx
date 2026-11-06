/**
 * 应用导航组合层：保持设备会话和运行批次摘要，并切换三个工作页面。
 */
import { useEffect, useState } from 'react'
import type { AutomationTask, BatchSummary, PendingRun } from '../../shared/types'
import { primaryRunSerial } from '../../shared/monitor-model'
import { DeviceManagerPage } from './components/device-manager-page'
import { RunMonitorPage } from './components/run-monitor-page'
import { TaskEditorPage } from './components/task-editor-page'
import { useDeviceFleet } from './hooks/use-device-fleet'
import { AppHeader, AppStatus, type Page } from './components/app-chrome'

/** 组合三个工作页面并维持跨页设备会话与运行状态。
 * @returns 桌面应用外壳及当前工作页面
 */
export default function App() {
  const [page, setPage] = useState<Page>('editor')
  const [message, setMessage] = useState('请在设备管理页连接设备。')
  const [batch, setBatch] = useState<BatchSummary | null>(null)
  const [pendingRun, setPendingRun] = useState<PendingRun | null>(null)
  const fleet = useDeviceFleet(setMessage)
  const running = Boolean(batch && !batch.finishedAt)

  useEffect(() => {
    void fleet.refresh()
    void window.androidAutoDesk.batchState().then(setBatch).catch((error) => setMessage(errorText(error)))
    let refreshTimer: number | null = null
    const off = window.androidAutoDesk.onRunEvent(() => {
      // 多设备会在同一瞬间上报步骤，合并摘要查询以免 IPC 排队。
      if (refreshTimer !== null) return
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null
        void window.androidAutoDesk.batchState().then(setBatch).catch(() => {})
      }, 100)
    })
    const deviceTimer = window.setInterval(() => { void fleet.refresh() }, 5000)
    const batchTimer = window.setInterval(() => {
      void window.androidAutoDesk.batchState().then(setBatch).catch(() => {})
    }, 2000)
    return () => { off(); if (refreshTimer !== null) window.clearTimeout(refreshTimer); window.clearInterval(deviceTimer); window.clearInterval(batchTimer) }
  }, [fleet.refresh])

  async function cancel(serial?: string): Promise<void> {
    try { await window.androidAutoDesk.cancelRun(serial); setMessage(serial ? `已请求取消设备 ${serial} 的任务。` : '已请求取消整个批次。') }
    catch (error) { setMessage(errorText(error)) }
  }

  /** 运行准备：先切工作台建立投屏，首要设备出画面后才下发任务（use-pending-run 编排）。 */
  function prepareRun(task: AutomationTask, targets: string[]): void {
    setPendingRun({ task, targets, primary: primaryRunSerial(targets, fleet.focused || null) })
    setPage('monitor')
  }

  /** 用户在准备期主动取消：不下发任务。 */
  function cancelPendingRun(): void {
    setPendingRun(null)
    setMessage('已取消运行准备。')
  }

  /** 任务已真正下发并创建批次：退出准备态并展示新批次。 */
  function launchRun(batch: BatchSummary): void {
    setPendingRun(null)
    setBatch(batch)
    setMessage(`任务已开始运行：${batch.devices.length} 台设备。`)
  }

  /** 下发失败：退出准备态并显式报错，不允许静默停留在等待中。 */
  function failRun(message: string): void {
    setPendingRun(null)
    setMessage(message)
  }

  /** 切页；准备期离开工作台视为取消，避免任务在无人监看时突然下发。 */
  function switchPage(next: Page): void {
    if (next !== 'monitor' && pendingRun) cancelPendingRun()
    setPage(next)
  }

  return <div className="app">
    <AppHeader page={page} count={fleet.connectedSerials.length} isRunning={running} onSwitch={switchPage} />

    <TaskEditorPage
      active={page === 'editor'} devices={fleet.devices} connectedSerials={fleet.connectedSerials}
      focused={fleet.focused} targets={fleet.targets} running={running} setFocused={fleet.setFocused}
      setMessage={setMessage} onShowDevices={() => switchPage('devices')}
      onRunPrepared={prepareRun}
    />
    {page === 'devices' && <DeviceManagerPage fleet={fleet} batch={batch} onFocus={(serial) => { fleet.setFocused(serial); switchPage('editor') }} />}
    {page === 'monitor' && <RunMonitorPage batch={batch} devices={fleet.devices} connectedSerials={fleet.connectedSerials} pendingRun={pendingRun}
      onRunLaunched={launchRun} onRunLaunchFailed={failRun} onPendingCancel={cancelPendingRun}
      onCancel={(serial) => void cancel(serial)} onOpenResult={(directory) => void window.androidAutoDesk.openRunDir(directory).catch((error) => setMessage(errorText(error)))} onError={setMessage} />}

    <AppStatus count={fleet.connectedSerials.length} message={message} />
  </div>
}

function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error) }
