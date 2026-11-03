/**
 * 运行工作台设备详情：显示所选设备的步骤、异常、逐条日志与处理入口。
 */
import { useEffect, useRef } from 'react'
import type { DeviceRun, RunEvent } from '../../../shared/types'
import type { MonitorRow } from '../../../shared/monitor-model'
import { STATUS_LABELS } from '../../../shared/monitor-model'

const LOG_PIN_THRESHOLD = 40; // 距底部小于该像素视为"吸底"，上翻超过即暂停自动滚动
const SMOOTH_MAX_DISTANCE = 240; // 追滚距离不超过该像素才做平滑动画，更大距离（整批日志载入）直接落底

type Props = {
  row: MonitorRow | null
  run: DeviceRun | null
  events: RunEvent[]
  loading: boolean
  error: string
  isActive: boolean
  onCancel: (serial: string) => void
  onOpenResult: (directory: string) => void
}

/** 所选设备即使被列表筛选隐藏，也继续展示对应详情。 */
export function MonitorDetail({ row, run, events, loading, error, isActive, onCancel, onOpenResult }: Props) {
  const latest = events.at(-1)
  const logRef = useRef<HTMLDivElement>(null)
  const isPinnedRef = useRef(true) // 是否贴着底部：决定新日志到达时是否自动跟随
  const isAutoScrollingRef = useRef(false) // 平滑滚动动画进行中：期间的滚动事件不代表用户主动上翻
  const lastSerialRef = useRef<string | null>(null) // 上次展示的设备序列号，用于识别切换设备

  useEffect(() => {
    const el = logRef.current
    if (!el) {
      lastSerialRef.current = null // 日志区随取消选择被卸载，下次选中任意设备都视为切换
      return
    }
    const serial = row?.serial ?? null
    if (lastSerialRef.current !== serial) {
      lastSerialRef.current = serial
      // 切换设备后默认回到吸底，避免沿用上一台设备的上翻阅读位置
      isPinnedRef.current = true
    }
    if (!isPinnedRef.current) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    if (distance <= 0) return
    // 系统开启"减弱动效"时尊重用户设置，不做平滑动画
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const smooth = distance <= SMOOTH_MAX_DISTANCE && !reduceMotion
    isAutoScrollingRef.current = smooth
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'instant' })
  }, [events, row?.serial])

  return <section className="page-card monitor-detail" aria-label="设备详情">
    <div className="monitor-panel-head"><h3>设备详情</h3></div>
    {!row ? <p className="monitor-empty">选择一台设备查看执行详情。</p> : <>
      <div className="monitor-detail-summary">
        <strong>{row.model}</strong><small>{row.serial}</small>
        <span className={`run-${row.status}`}>{STATUS_LABELS[row.status]}{run?.stepIndex === undefined ? '' : ` · 第 ${run.stepIndex + 1} 步`}</span>
        {!row.connected && <p className="monitor-detail-warning">设备已断开，无法查看实时画面。</p>}
        {run?.error && <p className="monitor-detail-error">{run.error}</p>}
        {!run?.error && latest && <p>{latest.message}</p>}
        <div className="monitor-detail-actions">
          {isActive && run && (run.status === 'pending' || run.status === 'running') && <button onClick={() => onCancel(row.serial)}>取消此设备</button>}
          {run?.runDir && <button onClick={() => onOpenResult(run.runDir!)}>打开结果目录</button>}
        </div>
      </div>
      <div className="monitor-log-head">执行日志</div>
      <div
        className="monitor-log"
        role="log"
        ref={logRef}
        onScroll={(e) => {
          if (isAutoScrollingRef.current) return
          const el = e.currentTarget
          isPinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < LOG_PIN_THRESHOLD
        }}
        onScrollEnd={() => { isAutoScrollingRef.current = false }}>
        {loading && <p>正在读取日志…</p>}
        {error && <p className="monitor-detail-error">{error}</p>}
        {!loading && !error && !events.length && <p>{run ? '暂无执行事件。' : '此设备未参与所选批次。'}</p>}
        {events.map((event, index) => <div className={`monitor-event run-${event.kind}`} key={`${event.at}-${index}`}><time>{new Date(event.at).toLocaleTimeString()}</time><span>{event.message}</span></div>)}
      </div>
    </>}
  </section>
}
