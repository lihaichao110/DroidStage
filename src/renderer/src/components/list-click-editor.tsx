/**
 * 列表批量步骤配置：选择容器、用户行及行内状态字段。
 */
import type { ListClickStep, Selector, UiNode } from '../../../shared/types'
import { suggestedSelector } from '../../../shared/task'

type Field = 'container' | 'row' | 'name' | 'identity' | 'action' | 'completed'
type Fields = Omit<ListClickStep, 'id' | 'type'>
type Props = {
  value: Fields
  selectedNode: UiNode | null
  nodes: readonly UiNode[]
  onChange: <K extends keyof Fields>(field: K, value: Fields[K]) => void
}
const labels: Record<Field, string> = {
  container: '滚动容器', row: '用户行', name: '显示名称', identity: '唯一标识',
  action: '待点击按钮', completed: '完成状态控件'
}
const fields: Field[] = ['container', 'row', 'name', 'identity', 'action', 'completed']

/** 将当前控件的稳定属性填入指定字段，行内字段按用户行相对查找。 */
function fromNode(node: UiNode, field: Field, nodes: readonly UiNode[]): Selector | null {
  if (field === 'container') return suggestedSelector(node, nodes)
  if (field === 'action' || field === 'completed') {
    // 按钮资源 ID 往往在“关注”和“已关注”两种状态间复用，优先使用状态文字。
    if (node.text) return { kind: 'text', value: node.text }
    if (node.description) return { kind: 'description', value: node.description }
    if (node.resourceId) return { kind: 'resourceId', value: node.resourceId }
  }
  if (field === 'name' || field === 'identity') {
    if (node.resourceId) return { kind: 'resourceId', value: node.resourceId }
    if (node.description) return { kind: 'description', value: node.description }
    if (node.text) return { kind: 'text', value: node.text }
  }
  if (node.resourceId) return { kind: 'resourceId', value: node.resourceId }
  if (node.className) return { kind: 'className', value: node.className }
  return null
}

/** 展示可手填与从控件树拾取的定位字段，完成状态可预先填写暂未出现的文本。 */
export function ListClickEditor({ value, selectedNode, nodes, onChange }: Props) {
  return <div className="list-click-editor">
    <p>先在左侧拾取控件，再点对应字段的“使用当前控件”。行内字段仅在选中的用户行中查找。</p>
    {fields.map((field) => <div className="list-field" key={field}>
      <strong>{labels[field]}</strong>
      <select value={value[field].kind} onChange={(event) => onChange(field, { kind: event.target.value as Selector['kind'], value: value[field].value })}>
        <option value="resourceId">资源 ID</option><option value="description">描述</option><option value="text">文字</option><option value="className">类名</option>
      </select>
      <input aria-label={labels[field]} value={value[field].value} placeholder={`填写${labels[field]}定位值`} onChange={(event) => onChange(field, { ...value[field], value: event.target.value })} />
      <button type="button" disabled={!selectedNode} onClick={() => { const selector = selectedNode && fromNode(selectedNode, field, nodes); if (selector) onChange(field, selector) }}>使用当前控件</button>
    </div>)}
    <label className="setting-field">滚动容器第几个匹配项（可选）<input type="number" min="1" max="10000" value={value.container.matchIndex ?? ''} placeholder="留空要求唯一匹配" onChange={(event) => onChange('container', { ...value.container, matchIndex: event.target.value ? Number(event.target.value) : undefined })} /></label>
    <p>名称用于日志；唯一标识必须对每位用户稳定且唯一。当前名单无重名时，两项可选择同一个名称控件。关注与已关注请使用能区分状态的文字或描述。</p>
    <label className="setting-field">最多滚动次数（1–1000）<input type="number" min="1" max="1000" value={value.maxScrolls} onChange={(event) => onChange('maxScrolls', Number(event.target.value))} /></label>
    <label className="setting-field">点击后确认超时（毫秒）<input type="number" min="100" max="60000" value={value.timeoutMs} onChange={(event) => onChange('timeoutMs', Number(event.target.value))} /></label>
  </div>
}
