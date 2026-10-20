/**
 * 设备画面页：每页最多六台已连接设备的只读实时画面。
 */
import { useEffect, useState } from 'react'
import type { BatchRecord, Device } from '../../../shared/types'
import { useScreenMirror } from '../hooks/use-screen-mirror'

type Props = { devices: Device[]; connectedSerials: string[]; batch: BatchRecord | null; onFocus: (serial: string) => void }
const PAGE_SIZE = 6

export function DeviceWallPage({ devices, connectedSerials, batch, onFocus }: Props) {
  const [page, setPage] = useState(0)
  const totalPages = Math.max(1, Math.ceil(connectedSerials.length / PAGE_SIZE))
  useEffect(() => { setPage((current) => Math.min(current, totalPages - 1)) }, [totalPages])
  const visible = connectedSerials.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  return <main className="page-content wall-page">
    <div className="page-heading"><div><h2>设备画面</h2><p>同时监看当前页的设备；切页后释放上一页的投屏。</p></div><div className="pager"><span>第 {page + 1} / {totalPages} 页 · 共 {connectedSerials.length} 台</span><button disabled={page === 0} onClick={() => setPage(page - 1)}>上一页</button><button disabled={page + 1 >= totalPages} onClick={() => setPage(page + 1)}>下一页</button></div></div>
    {!visible.length ? <div className="page-card wall-empty">还没有已连接设备。请先在设备管理页连接设备。</div> : <div className="wall-grid">
      {visible.map((serial) => {
        const device = devices.find((item) => item.serial === serial)
        const run = batch && !batch.finishedAt ? batch.devices.find((item) => item.serial === serial) : null
        return <section className="page-card wall-card" key={serial}>
          <div className="wall-card-head"><div><strong>{device?.model || 'Android 设备'}</strong><small>{serial}</small></div><span className={`state-pill ${run?.status === 'running' ? 'warn' : 'ok'}`}>{run?.status === 'running' ? run.stepIndex === undefined ? '启动中' : `执行第 ${run.stepIndex + 1} 步` : run?.status === 'pending' ? '待运行' : '已连接'}</span></div>
          <WallScreen serial={serial} />
          <div className="wall-card-foot"><span>只读监看</span><button onClick={() => onFocus(serial)}>设为编辑设备</button></div>
        </section>
      })}
    </div>}
  </main>
}

/** 每张卡片独立订阅自己的视频流，页面卸载时 Hook 会停止该设备投屏。 */
function WallScreen({ serial }: { serial: string }) {
  const { canvasRef, status, restart } = useScreenMirror(serial, true, false, 'wall')
  return <div className="wall-screen">
    <canvas ref={canvasRef} aria-label={`设备 ${serial} 的实时画面`} />
    {status.state === 'starting' && <div className="wall-overlay">正在建立投屏…</div>}
    {(status.state === 'error' || status.state === 'stopped') && <div className="wall-overlay"><span>{status.state === 'error' ? status.message : '投屏已停止'}</span><button onClick={restart}>重试</button></div>}
  </div>
}
