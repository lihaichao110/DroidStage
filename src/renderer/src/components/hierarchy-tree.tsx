/**
 * 可折叠控件树容器：头部（计数、展开/收起全部、搜索）、空态与展开状态管理。
 * 选中定位滚动、与截图悬浮预览的联动在本组件协调，行渲染见 tree-rows.tsx。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Point, UiNode } from '../../../shared/types'
import { ancestorsOf, buildHierarchyTree, collectParentIds, filterTree } from '../utils/hierarchy-tree'
import { TreeRows } from './tree-rows'

type HierarchyTreeProps = {
  nodes: UiNode[]
  selectedId: string | null
  hoverNode: UiNode | null
  onSelect: (node: UiNode, point: Point) => void
  onHoverNode: (node: UiNode | null) => void
}

// 默认展开到第 1 层（第 2 层节点直接可见），更深的子树手动展开，避免一次性渲染整棵深树
const DEFAULT_EXPAND_DEPTH = 1

// 头部小图标统一 16×16 线性风格，静态 JSX 常量避免每次渲染重建
const SEARCH_ICON = (
  <svg className="tree-search-icon" width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="7" cy="7" r="4.6" stroke="currentColor" strokeWidth="1.5" />
    <path d="M10.4 10.4L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
)
const EXPAND_ALL_ICON = (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M4 3.5l4 3.5 4-3.5M4 8.5l4 3.5 4-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)
const COLLAPSE_ALL_ICON = (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M4 6.5l4-3.5 4 3.5M4 11.5l4-3.5 4 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)
const CLEAR_ICON = (
  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
)

export function HierarchyTree({ nodes, selectedId, hoverNode, onSelect, onHoverNode }: HierarchyTreeProps) {
  const [filter, setFilter] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const containerRef = useRef<HTMLDivElement>(null)
  const lastScrolledId = useRef<string | null>(null)

  const roots = useMemo(() => buildHierarchyTree(nodes), [nodes])

  // 新快照重置展开状态：只展开浅层，防止上个页面的展开痕迹干扰新页面浏览
  useEffect(() => {
    setExpanded(new Set(nodes.filter((node) => node.depth <= DEFAULT_EXPAND_DEPTH).map((node) => node.id)))
    lastScrolledId.current = null
  }, [nodes])

  // 选中变化时展开祖先链：截图点选常命中折叠子树里的节点，必须先展开目标行才渲染得出来
  useEffect(() => {
    if (!selectedId) return
    setExpanded((previous) => {
      const missing = ancestorsOf(selectedId).filter((id) => !previous.has(id))
      return missing.length ? new Set([...previous, ...missing]) : previous
    })
  }, [selectedId])

  // 目标行渲染出来后再滚动定位；行不存在（如被搜索过滤掉）时不记账，待下次重渲染重试
  useEffect(() => {
    if (!selectedId || lastScrolledId.current === selectedId) return
    const row = containerRef.current?.querySelector(`[data-node-id="${CSS.escape(selectedId)}"]`)
    if (!row) return
    lastScrolledId.current = selectedId
    row.scrollIntoView({ block: 'nearest' })
  }, [selectedId, expanded, filter, roots])

  const query = filter.trim().toLowerCase()
  const searching = query.length > 0
  const view = useMemo(() => {
    if (!searching) return { roots, matchCount: -1 }
    return filterTree(roots, (node) => [node.text, node.description, node.resourceId, node.className].some((value) => value.toLowerCase().includes(query)))
  }, [roots, query, searching])

  function toggle(id: string): void {
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // 展开全部按完整树收集父节点：搜索过滤状态下也要覆盖未命中的分支，清空搜索后状态才完整
  function expandAll(): void {
    setExpanded(new Set(collectParentIds(roots)))
  }

  // 收起全部回到新快照的默认展开深度，让「收起」与「刷新后的初始状态」行为一致、可预期
  function collapseAll(): void {
    setExpanded(new Set(nodes.filter((node) => node.depth <= DEFAULT_EXPAND_DEPTH).map((node) => node.id)))
  }

  const hasNodes = nodes.length > 0
  return <div className="tree-area">
    <div className="tree-head">
      <h3>控件树</h3>
      {hasNodes && <span className="tree-count">{nodes.length}</span>}
      <div className="tree-actions">
        <button type="button" className="icon-btn" title="展开全部" aria-label="展开全部" disabled={!hasNodes} onClick={expandAll}>{EXPAND_ALL_ICON}</button>
        <button type="button" className="icon-btn" title="收起全部" aria-label="收起全部" disabled={!hasNodes} onClick={collapseAll}>{COLLAPSE_ALL_ICON}</button>
      </div>
      <div className="tree-search-box">
        {SEARCH_ICON}
        <input className="tree-search" placeholder="搜索控件" aria-label="搜索控件" value={filter} onChange={(event) => setFilter(event.target.value)} />
        {filter !== '' && <button type="button" className="tree-search-clear" title="清空搜索" aria-label="清空搜索" onClick={() => setFilter('')}>{CLEAR_ICON}</button>}
      </div>
    </div>
    {searching && (
      <div className="tree-match">
        <span>匹配 {view.matchCount} 个控件</span>
        <button type="button" className="tree-match-clear" onClick={() => setFilter('')}>清空</button>
      </div>
    )}
    <div className="tree" role="list" ref={containerRef}>
      {view.roots.length === 0
        ? <p className="muted tree-empty">{searching ? '没有匹配的控件，换个关键词试试' : '连接手机后，点击上方「刷新层级」抓取画面'}</p>
        : <TreeRows entries={view.roots} expanded={expanded} searching={searching} selectedId={selectedId} hoverId={hoverNode?.id ?? null} onSelect={onSelect} onHoverNode={onHoverNode} onToggle={toggle} />}
    </div>
  </div>
}
