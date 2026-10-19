/**
 * 选中控件详情：完整属性表、定位方式选择，以及当前定位条件的实时匹配数校验。
 */
import { useEffect, useState } from 'react'
import type { Point, Selector, UiNode } from '../../../shared/types'

type ElementDetailsProps = {
  node: UiNode | null
  selector: Selector | null
  selectedPoint: Point | null
  isConnected: boolean
  onSelectorChange: (selector: Selector | null) => void
}

// 匹配数查询防抖：定位方式下拉切换过程中避免连发 IPC
const COUNT_DEBOUNCE_MS = 300

type MatchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; count: number }
  | { status: 'error'; message: string }

export function ElementDetails({ node, selector, selectedPoint, isConnected, onSelectorChange }: ElementDetailsProps) {
  const [match, setMatch] = useState<MatchState>({ status: 'idle' })

  const kind = selector?.kind
  const value = selector?.value

  useEffect(() => {
    // 未连接或没有定位条件时不查询；查询失败如实展示错误，不做静默降级
    if (!isConnected || !selector) {
      setMatch({ status: 'idle' })
      return
    }
    setMatch({ status: 'loading' })
    const timer = setTimeout(() => {
      window.androidAutoDesk.count(selector)
        .then((count) => setMatch({ status: 'done', count }))
        .catch((error: unknown) => setMatch({ status: 'error', message: error instanceof Error ? error.message : String(error) }))
    }, COUNT_DEBOUNCE_MS)
    return () => clearTimeout(timer)
    // 依赖取 kind/value 而非 selector 对象：同值新对象不重复查询
  }, [isConnected, kind, value, selector])

  /** 切换定位方式：从选中控件取对应属性值；选“坐标”即清除控件定位。 */
  function changeKind(next: string): void {
    if (next === 'point') {
      onSelectorChange(null)
      return
    }
    const selectorKind = next as Selector['kind']
    const nextValue = selectorKind === 'resourceId' ? node?.resourceId
      : selectorKind === 'description' ? node?.description
        : selectorKind === 'text' ? node?.text
          : node?.className
    onSelectorChange(nextValue ? { kind: selectorKind, value: nextValue } : null)
  }

  return <div className="selection">
    <strong>当前选择</strong>
    {node ? <>
      <table className="attrs">
        <tbody>
          <AttrRow label="文本" value={node.text} />
          <AttrRow label="描述" value={node.description} />
          <AttrRow label="资源 ID" value={node.resourceId} />
          <AttrRow label="类名" value={node.className} />
          <AttrRow label="所属应用" value={node.packageName} />
          <AttrRow label="可点击" value={node.clickable ? '是' : '否'} />
          <AttrRow label="边界" value={`[${node.bounds.left},${node.bounds.top}] [${node.bounds.right},${node.bounds.bottom}]`} />
          <AttrRow label="节点路径" value={node.id} />
        </tbody>
      </table>
      <label>定位方式 <select value={kind ?? 'point'} onChange={(event) => changeKind(event.target.value)}>
        {node.resourceId && <option value="resourceId">资源 ID</option>}
        {node.description && <option value="description">描述</option>}
        {node.text && <option value="text">文字</option>}
        {node.className && <option value="className">类名</option>}
        <option value="point">坐标（布局变化风险）</option>
      </select></label>
    </> : <span>{selector ? `${selector.kind}: ${selector.value}` : selectedPoint ? `坐标 (${selectedPoint.x}, ${selectedPoint.y})` : '未选择'}</span>}
    {selector && <MatchStatus match={match} />}
  </div>
}

/** 属性行：空值显示占位符，保证表结构稳定易扫读。 */
function AttrRow({ label, value }: { label: string; value: string }) {
  return <tr><th>{label}</th><td>{value || '—'}</td></tr>
}

function MatchStatus({ match }: { match: MatchState }) {
  if (match.status === 'idle') return null
  if (match.status === 'loading') return <small className="match-loading">正在统计匹配数…</small>
  if (match.status === 'error') return <small className="match-warn">匹配数查询失败：{match.message}</small>
  if (match.count === 1) return <small className="match-ok">当前定位条件匹配 1 个控件</small>
  return <small className="match-warn">当前定位条件匹配 {match.count} 个控件，需恰好 1 个</small>
}
