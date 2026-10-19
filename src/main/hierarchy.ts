import { XMLParser } from 'fast-xml-parser'
import type { Bounds, UiNode } from '../shared/types'

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseAttributeValue: false })

export function parseBounds(raw: string): Bounds {
  const match = /^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/.exec(raw)
  if (!match) return { left: 0, top: 0, right: 0, bottom: 0 }
  return { left: +match[1], top: +match[2], right: +match[3], bottom: +match[4] }
}

export function parseHierarchy(xml: string): UiNode[] {
  if (xml.length > 10_000_000) throw new Error('控件树过大')
  const data = parser.parse(xml) as Record<string, unknown>
  const result: UiNode[] = []
  function visit(value: unknown, id: string, depth: number): void {
    if (!value || typeof value !== 'object' || result.length >= 10000) return
    const node = value as Record<string, unknown>
    result.push({
      id,
      depth,
      text: String(node['@_text'] ?? ''),
      resourceId: String(node['@_resource-id'] ?? ''),
      description: String(node['@_content-desc'] ?? ''),
      className: String(node['@_class'] ?? ''),
      packageName: String(node['@_package'] ?? ''),
      clickable: node['@_clickable'] === 'true',
      bounds: parseBounds(String(node['@_bounds'] ?? ''))
    })
    const children = node.node ? (Array.isArray(node.node) ? node.node : [node.node]) : []
    children.forEach((child, index) => visit(child, `${id}.${index}`, depth + 1))
  }
  const root = data.hierarchy as Record<string, unknown> | undefined
  if (!root) throw new Error('控件树格式无效')
  const children = root.node ? (Array.isArray(root.node) ? root.node : [root.node]) : []
  children.forEach((child, index) => visit(child, String(index), 0))
  return result
}
