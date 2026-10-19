/**
 * 控件树纯逻辑：由快照的扁平节点列表构建父子树、推导祖先链与搜索过滤。
 */
import type { UiNode } from '../../../shared/types'

export type HierarchyTreeNode = { node: UiNode; children: HierarchyTreeNode[] }

/**
 * 由快照的扁平节点数组（DFS 顺序）构建父子树。
 * 节点 id 是按兄弟索引拼接的路径（如 "0.1.2"），去掉最后一段即父节点 id；
 * DFS 顺序保证父节点先于子节点出现，一次遍历即可完成挂接。
 * @param nodes 快照中的扁平控件节点
 * @returns 根节点构成的森林（多窗口时不止一个根）
 */
export function buildHierarchyTree(nodes: UiNode[]): HierarchyTreeNode[] {
  const byId = new Map<string, HierarchyTreeNode>()
  const roots: HierarchyTreeNode[] = []
  for (const node of nodes) {
    const entry: HierarchyTreeNode = { node, children: [] }
    byId.set(node.id, entry)
    const parentId = parentOf(node.id)
    const parent = parentId ? byId.get(parentId) : undefined
    // 父节点缺失（层级异常）时按根处理，避免整棵子树在界面上丢失
    if (parent) parent.children.push(entry)
    else roots.push(entry)
  }
  return roots
}

/**
 * 取节点路径的父节点 id。
 * @param id 节点路径，如 "0.1.2"
 * @returns 父节点 id（"0.1"）；根节点（如 "0"）返回 null
 */
export function parentOf(id: string): string | null {
  const index = id.lastIndexOf('.')
  return index === -1 ? null : id.slice(0, index)
}

/**
 * 取节点的全部祖先 id，按从根到直接父节点的顺序排列；根节点返回空数组。
 * @param id 节点路径
 */
export function ancestorsOf(id: string): string[] {
  const ancestors: string[] = []
  let current = parentOf(id)
  while (current !== null) {
    ancestors.unshift(current)
    current = parentOf(current)
  }
  return ancestors
}

/**
 * 收集树中所有含子节点的节点 id（DFS 顺序），供「展开全部」一次性填充展开集合。
 * 叶子节点不需要出现在展开集合里（无子树可展开）。
 * @param roots 完整树
 */
export function collectParentIds(roots: HierarchyTreeNode[]): string[] {
  const ids: string[] = []
  const walk = (entries: HierarchyTreeNode[]): void => {
    for (const entry of entries) {
      if (entry.children.length === 0) continue
      ids.push(entry.node.id)
      walk(entry.children)
    }
  }
  walk(roots)
  return ids
}

export type TreeFilterResult = { roots: HierarchyTreeNode[]; matchCount: number }

/**
 * 按谓词过滤树：只保留命中节点与命中节点的祖先链（祖先仅作路径上下文），其余分支剪掉。
 * 这样搜索结果聚焦命中项并保留层级线索，命中容器下的大量无关子节点不会涌入结果。
 * @param roots 完整树
 * @param predicate 命中谓词
 * @returns 过滤后的森林与命中节点总数
 */
export function filterTree(roots: HierarchyTreeNode[], predicate: (node: UiNode) => boolean): TreeFilterResult {
  let matchCount = 0
  const walk = (entries: HierarchyTreeNode[]): HierarchyTreeNode[] => {
    const kept: HierarchyTreeNode[] = []
    for (const entry of entries) {
      const children = walk(entry.children)
      const matched = predicate(entry.node)
      if (matched) matchCount += 1
      if (matched || children.length > 0) kept.push({ node: entry.node, children })
    }
    return kept
  }
  return { roots: walk(roots), matchCount }
}
