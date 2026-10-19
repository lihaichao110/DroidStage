/**
 * 控件树递归行渲染：箭头、主标签、#resource-id 短名与类型短名的单行展示。
 * 悬浮/选中/联动高亮与缩进引导线均由样式驱动，组件只负责结构与数据派生。
 */
import type { Point, UiNode } from '../../../shared/types'
import type { HierarchyTreeNode } from '../utils/hierarchy-tree'

// 缩进基准与步长：步长必须与样式里的引导线网格（16px 一列）一致，改一处须同步另一处
const INDENT_BASE = 6
const INDENT_STEP = 16

type TreeRowsProps = {
  entries: HierarchyTreeNode[]
  expanded: ReadonlySet<string>
  searching: boolean
  selectedId: string | null
  hoverId: string | null
  onSelect: (node: UiNode, point: Point) => void
  onHoverNode: (node: UiNode | null) => void
  onToggle: (id: string) => void
}

/**
 * 取类短名：android.widget.Button → Button；无包名的类名原样返回。
 * @param className 完整类名
 */
function shortClassName(className: string): string {
  return className.split('.').pop() || className
}

/**
 * resource-id 形如 "com.android.settings:id/entry"，行内只展示斜杠后的短名降低噪音，
 * 完整 id 保留在行 title 里供悬浮查看。
 */
function shortResourceId(resourceId: string): string {
  const index = resourceId.lastIndexOf('/')
  return index === -1 ? resourceId : resourceId.slice(index + 1)
}

/**
 * 原生 title 提示：悬浮行即可看到完整定位信息（文字/描述、完整 id、类名、坐标），不必点开详情面板。
 * @param node 当前行对应的控件节点
 */
function rowTitle(node: UiNode): string {
  const parts = [
    node.text || node.description || shortClassName(node.className),
    node.resourceId ? `#${node.resourceId}` : '',
    node.className,
    node.clickable ? '可点击' : '',
    `(${node.bounds.left},${node.bounds.top})-(${node.bounds.right},${node.bounds.bottom})`
  ]
  return parts.filter(Boolean).join(' · ')
}

/**
 * 递归渲染控件树行：每行 = 箭头 + 主标签 + #id 短名 + 类型短名，有子节点且展开时递归渲染子层。
 * @param entries 当前层的树节点与其子节点
 */
export function TreeRows({ entries, expanded, searching, selectedId, hoverId, onSelect, onHoverNode, onToggle }: TreeRowsProps) {
  return <>
    {entries.map(({ node, children }) => {
      const hasChildren = children.length > 0
      // 搜索视图下命中子树全部展开，其余按用户折叠状态
      const isExpanded = searching || expanded.has(node.id)
      // 无 text/description 的是纯结构节点：标签直接用类短名，样式弱化且不重复显示右侧类型短名
      const isStructural = !node.text && !node.description
      const depth = Math.min(node.depth, 10)
      const point = { x: Math.floor((node.bounds.left + node.bounds.right) / 2), y: Math.floor((node.bounds.top + node.bounds.bottom) / 2) }
      const state = `${node.id === selectedId ? ' selected' : ''}${node.id === hoverId ? ' hovered' : ''}${isStructural ? ' structural' : ''}`
      return <div key={node.id}>
        <div className={`tree-row${state}`} role="listitem" data-node-id={node.id} data-expanded={isExpanded ? 'true' : 'false'}
          title={rowTitle(node)}
          style={{ paddingLeft: `${INDENT_BASE + depth * INDENT_STEP}px`, backgroundSize: `${depth * INDENT_STEP}px 100%` }}
          onClick={() => onSelect(node, point)} onMouseEnter={() => onHoverNode(node)} onMouseLeave={() => onHoverNode(null)}>
          <button type="button" className={`tree-toggle${hasChildren ? '' : ' leaf'}`} disabled={!hasChildren} aria-hidden="true" tabIndex={-1}
            onClick={(event) => { event.stopPropagation(); onToggle(node.id) }}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M6 3.5l4.5 4.5L6 12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <span className="tree-label">{node.text || node.description || shortClassName(node.className)}</span>
          {node.resourceId && <code className="tree-id">#{shortResourceId(node.resourceId)}</code>}
          {!isStructural && <span className="tree-type">{shortClassName(node.className)}</span>}
        </div>
        {hasChildren && isExpanded && <TreeRows entries={children} expanded={expanded} searching={searching} selectedId={selectedId} hoverId={hoverId} onSelect={onSelect} onHoverNode={onHoverNode} onToggle={onToggle} />}
      </div>
    })}
  </>
}
