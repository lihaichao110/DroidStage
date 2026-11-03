/**
 * 运行工作台画面区：仅对当前和固定设备建立只读投屏。
 */
import type { Device } from '../../../shared/types'
import { useScreenMirror } from '../hooks/use-screen-mirror'

type Props = {
  serials: string[]
  devices: Device[]
  connectedSerials: string[]
  pinnedSerials: string[]
  selectedSerial: string
  isHistory: boolean
  onUnpin: (serial: string) => void
}

/** 历史批次不展示设备当前画面，避免把实时状态误认为历史回放。 */
export function MonitorPreview({ serials, devices, connectedSerials, pinnedSerials, selectedSerial, isHistory, onUnpin }: Props) {
  return <section className="page-card monitor-preview" aria-label="实时画面">
    <div className="monitor-panel-head"><h3>重点画面</h3><span>只读 · {isHistory ? '历史无实时画面' : `${serials.length} / 4 路`}</span></div>
    {isHistory ? <div className="monitor-preview-empty">历史批次只保留执行记录，不提供实时画面回放。</div>
      : !serials.length ? <div className="monitor-preview-empty">选择左侧设备后显示实时画面。</div>
        : <div className={`monitor-preview-grid count-${serials.length}`}>
          {serials.map((serial) => <MonitorScreen key={serial} serial={serial} model={devices.find((device) => device.serial === serial)?.model || 'Android 设备'}
            connected={connectedSerials.includes(serial)} selected={serial === selectedSerial} pinned={pinnedSerials.includes(serial)} onUnpin={() => onUnpin(serial)} />)}
        </div>}
  </section>
}

/** 单张画面独立持有解码器，卸载或断线时由 Hook 停止投屏。 */
function MonitorScreen({ serial, model, connected, selected, pinned, onUnpin }: { serial: string; model: string; connected: boolean; selected: boolean; pinned: boolean; onUnpin: () => void }) {
  const { canvasRef, status, restart } = useScreenMirror(serial, connected, false, 'wall')
  return <div className="monitor-screen-card">
    <div className="monitor-screen-head"><div><strong>{model}</strong><small>{serial}</small></div><div>{selected && <span className="monitor-screen-label">当前</span>}{pinned && <button onClick={onUnpin} aria-label={`取消固定 ${serial}`}>取消固定</button>}</div></div>
    <div className="monitor-screen-stage">
      {connected && <canvas ref={canvasRef} aria-label={`设备 ${serial} 的实时画面`} />}
      {!connected && <div className="monitor-screen-overlay">设备已断开，画面暂不可用</div>}
      {connected && status.state === 'starting' && <div className="monitor-screen-overlay">正在建立投屏…</div>}
      {connected && (status.state === 'error' || status.state === 'stopped') && <div className="monitor-screen-overlay"><span>{status.state === 'error' ? status.message : '投屏已停止'}</span><button onClick={restart}>重试画面</button></div>}
    </div>
  </div>
}
