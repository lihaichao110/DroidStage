/**
 * 选中控件详情：完整属性表、定位方式选择，以及当前定位条件的实时匹配数校验。
 */
import { useEffect, useState } from 'react'
import type { MatchInfo, Point, Selector, UiNode } from '../../../shared/types'
import { indexedMatchIsDistinct, sortedMatches } from '../../../shared/task'

type ElementDetailsProps = {
  serial: string
  node: UiNode | null
  nodes: readonly UiNode[]
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
  | { status: 'done'; matches: MatchInfo[] }
  | { status: 'error'; message: string }

export function ElementDetails({ serial, node, nodes, selector, selectedPoint, isConnected, onSelectorChange }: ElementDetailsProps) {
  const [match, setMatch] = useState<MatchState>({ status: 'idle' })

  const kind = selector?.kind
  const value = selector?.value

  useEffect(() => {
    // 未连接或没有定位条件时不查询；查询失败如实展示错误，不做静默降级
    if (!isConnected || !serial || !selector) {
      setMatch({ status: 'idle' })
      return
    }
    setMatch({ status: 'loading' })
    let active = true
    const timer = setTimeout(() => {
      window.androidAutoDesk.inspectMatches(serial, selector)
        .then((matches) => { if (active) setMatch({ status: 'done', matches }) })
        .catch((error: unknown) => { if (active) setMatch({ status: 'error', message: error instanceof Error ? error.message : String(error) }) })
    }, COUNT_DEBOUNCE_MS)
    return () => { active = false; clearTimeout(timer) }
    // 依赖取 kind/value 而非 selector 对象：同值新对象不重复查询
  }, [serial, isConnected, kind, value])

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
    if (!nextValue) { onSelectorChange(null); return }
    const candidates = sortedMatches(nodes.filter((candidate) => candidate[selectorKind] === nextValue))
    const index = candidates.findIndex((candidate) => candidate.id === node?.id)
    const isDistinct = index >= 0 && indexedMatchIsDistinct(candidates.map((candidate) => candidate.bounds), index + 1)
    onSelectorChange({ kind: selectorKind, value: nextValue, ...(candidates.length > 1 && isDistinct ? { matchIndex: index + 1 } : {}) })
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
          <AttrRow label="可滚动" value={node.scrollable ? '是' : '否'} />
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
    {selector && <MatchStatus match={match} selector={selector} onSelectorChange={onSelectorChange} />}
  </div>
}

/** 属性行：空值显示占位符，保证表结构稳定易扫读。 */
function AttrRow({ label, value }: { label: string; value: string }) {
  return <tr><th>{label}</th><td>{value || '—'}</td></tr>
}

function MatchStatus({ match, selector, onSelectorChange }: { match: MatchState; selector: Selector; onSelectorChange: (selector: Selector) => void }) {
  if (match.status === 'idle') return null
  if (match.status === 'loading') return <small className="match-loading">正在统计匹配数…</small>
  if (match.status === 'error') return <small className="match-warn">匹配数查询失败：{match.message}</small>
  const { matches } = match
  const selected = selector.matchIndex ?? (matches.length === 1 ? 1 : 0)
  const target = matches.find((item) => item.index === selected)
  const ambiguous = target && matches.some((item) => item.index !== selected && JSON.stringify(item.bounds) === JSON.stringify(target.bounds))
  return <div className="match-options">
    <small className={target && !ambiguous ? 'match-ok' : 'match-warn'}>当前定位条件匹配 {matches.length} 个控件{selector.matchIndex ? `，已选第 ${selector.matchIndex} 个` : matches.length === 1 ? '' : '，请选择目标序号'}{ambiguous ? '；目标边界与其他控件重合，无法安全区分' : ''}</small>
    {matches.map((item) => <label key={item.index} className={selected === item.index ? 'match-choice selected' : 'match-choice'}>
      <input type="radio" name="match-index" checked={selected === item.index} onChange={() => onSelectorChange({ ...selector, matchIndex: item.index })} />
      第 {item.index} 个　[{item.bounds.left},{item.bounds.top}]–[{item.bounds.right},{item.bounds.bottom}]
    </label>)}
    {selector.matchIndex && <button type="button" className="submission-link" onClick={() => onSelectorChange({ kind: selector.kind, value: selector.value })}>取消指定序号</button>}
  </div>
}
