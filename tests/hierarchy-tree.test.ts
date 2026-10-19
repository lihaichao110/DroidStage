import { describe, expect, it } from 'vitest'
import { ancestorsOf, buildHierarchyTree, collectParentIds, filterTree, parentOf } from '../src/renderer/src/utils/hierarchy-tree'
import type { UiNode } from '../src/shared/types'

function makeNode(id: string, depth: number, text: string): UiNode {
  return {
    id, depth, text, resourceId: '', description: '', className: 'android.widget.TextView',
    packageName: 'com.example', clickable: false, bounds: { left: 0, top: 0, right: 10, bottom: 10 }
  }
}

describe('控件树构建', () => {
  it('按节点路径还原父子关系，多根时保留森林结构', () => {
    const nodes = [makeNode('0', 0, '窗口一'), makeNode('0.0', 1, '布局'), makeNode('0.0.0', 2, '按钮'), makeNode('1', 0, '窗口二')]
    const roots = buildHierarchyTree(nodes)
    expect(roots.map((entry) => entry.node.id)).toEqual(['0', '1'])
    expect(roots[0].children.map((entry) => entry.node.id)).toEqual(['0.0'])
    expect(roots[0].children[0].children.map((entry) => entry.node.id)).toEqual(['0.0.0'])
    expect(roots[1].children).toHaveLength(0)
  })

  it('父节点缺失的异常节点按根处理，不丢失子树', () => {
    const nodes = [makeNode('0', 0, '根'), makeNode('5.1', 2, '孤儿')]
    const roots = buildHierarchyTree(nodes)
    expect(roots.map((entry) => entry.node.id)).toEqual(['0', '5.1'])
  })

  it('由路径推导父节点与祖先链，根节点无祖先', () => {
    expect(parentOf('0.1.2')).toBe('0.1')
    expect(parentOf('0')).toBeNull()
    expect(ancestorsOf('0.1.2')).toEqual(['0', '0.1'])
    expect(ancestorsOf('0')).toEqual([])
  })
})

describe('控件树搜索过滤', () => {
  const nodes = [makeNode('0', 0, '首页'), makeNode('0.0', 1, '列表'), makeNode('0.0.0', 2, '登录'), makeNode('0.1', 1, '设置'), makeNode('1', 0, '弹窗')]

  it('命中节点及其祖先链保留，未命中的子节点与无关分支剪掉', () => {
    const { roots, matchCount } = filterTree(buildHierarchyTree(nodes), (node) => node.text === '列表')
    expect(matchCount).toBe(1)
    expect(roots.map((entry) => entry.node.id)).toEqual(['0'])
    const list = roots[0].children[0]
    expect(list.node.text).toBe('列表')
    // 命中容器下未命中的子节点（登录）同样被剪掉，避免大量无关结果涌入
    expect(list.children).toHaveLength(0)
    // 未命中且无命中后代的“设置”分支被剪掉
    expect(roots[0].children).toHaveLength(1)
  })

  it('父子同时命中时链路完整保留', () => {
    const { roots, matchCount } = filterTree(buildHierarchyTree(nodes), (node) => node.text === '列表' || node.text === '登录')
    expect(matchCount).toBe(2)
    expect(roots[0].children[0].children.map((entry) => entry.node.text)).toEqual(['登录'])
  })

  it('没有任何命中时返回空森林与计数 0', () => {
    const { roots, matchCount } = filterTree(buildHierarchyTree(nodes), (node) => node.text === '不存在')
    expect(roots).toHaveLength(0)
    expect(matchCount).toBe(0)
  })
})

describe('展开全部用的父节点收集', () => {
  it('只收集含子节点的节点 id，叶子与空树不产生 id', () => {
    const nodes = [makeNode('0', 0, '首页'), makeNode('0.0', 1, '列表'), makeNode('0.0.0', 2, '登录'), makeNode('0.1', 1, '设置'), makeNode('1', 0, '弹窗')]
    // 树形：0 与 0.0 含子节点；0.0.0、0.1、1 均为叶子
    expect(collectParentIds(buildHierarchyTree(nodes))).toEqual(['0', '0.0'])
    expect(collectParentIds(buildHierarchyTree([]))).toEqual([])
    expect(collectParentIds(buildHierarchyTree([makeNode('0', 0, '孤立叶子')]))).toEqual([])
  })
})
