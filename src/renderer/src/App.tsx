/**
 * 应用导航组合层：保持设备会话和运行批次摘要，并切换三个工作页面。
 */
import { useEffect, useState } from 'react'
import type { BatchSummary } from '../../shared/types'
import { DeviceManagerPage } from './components/device-manager-page'
import { RunMonitorPage } from './components/run-monitor-page'
import { TaskEditorPage } from './components/task-editor-page'
import { useDeviceFleet } from './hooks/use-device-fleet'
import droidstageIcon from './assets/droidstage-icon.png'

type Page = 'editor' | 'devices' | 'monitor'
const PAGES: { id: Page; label: string }[] = [
  { id: 'editor', label: '任务编辑' }, { id: 'devices', label: '设备管理' },
  { id: 'monitor', label: '运行工作台' }
]

export default function App() {
  const [page, setPage] = useState<Page>('editor')
  const [message, setMessage] = useState('请在设备管理页连接设备。')
  const [batch, setBatch] = useState<BatchSummary | null>(null)
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

  return <div className="app">
    <header className="topbar">
      <div className="brand"><img src={droidstageIcon} alt="" /><h1>卓序</h1></div>
      <nav className="page-tabs" aria-label="主页面">
        {PAGES.map((item) => <button key={item.id} className={page === item.id ? 'active' : ''} aria-current={page === item.id ? 'page' : undefined} onClick={() => setPage(item.id)}>{item.label}{item.id === 'monitor' && running && <span className="nav-live" />}</button>)}
      </nav>
      <div className="top-summary"><span>{fleet.connectedSerials.length} 台已连接</span><span className={running ? 'running' : ''}>{running ? '任务运行中' : '空闲'}</span></div>
    </header>

    <TaskEditorPage
      active={page === 'editor'} devices={fleet.devices} connectedSerials={fleet.connectedSerials}
      focused={fleet.focused} targets={fleet.targets} running={running} setFocused={fleet.setFocused}
      setMessage={setMessage} onShowDevices={() => setPage('devices')}
      onBatchStarted={(record) => { setBatch(record); setPage('monitor') }}
    />
    {page === 'devices' && <DeviceManagerPage fleet={fleet} batch={batch} onFocus={(serial) => { fleet.setFocused(serial); setPage('editor') }} />}
    {page === 'monitor' && <RunMonitorPage batch={batch} devices={fleet.devices} connectedSerials={fleet.connectedSerials} onCancel={(serial) => void cancel(serial)} onOpenResult={(directory) => void window.androidAutoDesk.openRunDir(directory).catch((error) => setMessage(errorText(error)))} onError={setMessage} />}

    <div className="app-status" role="status"><span className="status-dot" />{message}{message.includes('驱动') && <a href="https://developer.android.com/studio/run/oem-usb" target="_blank" rel="noreferrer">厂商驱动说明</a>}</div>
  </div>
}

function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error) }
