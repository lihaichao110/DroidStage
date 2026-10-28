/**
 * 列表批量步骤配置：按身份或行状态定位，并只读预览当前屏的识别结果。
 */
import { useEffect, useState } from 'react'
import type { ListClickDraft, ListPreviewRow, Selector, UiNode } from '../../../shared/types'
import { buildListStep, deriveRowDepth, listFieldLabels, suggestedRowSelector, suggestedSelector, validateTask } from '../../../shared/task'
import { listPreviewIssue } from '../../../shared/list-preview'

type Field = 'container' | 'row' | 'name' | 'identity' | 'action' | 'completed'
type Props = {
  serial: string
  isConnected: boolean
  value: ListClickDraft
  selectedNode: UiNode | null
  nodes: readonly UiNode[]
  onChange: <K extends keyof ListClickDraft>(field: K, value: ListClickDraft[K]) => void
}
const labels = listFieldLabels

/** 行内状态优先按文字定位，避免关注和已关注共用同一资源 ID。 */
function fromNode(node: UiNode, field: Field, nodes: readonly UiNode[]): Selector | null {
  if (field === 'container') return suggestedSelector(node, nodes)
  if (field === 'action' || field === 'completed') {
    if (node.text) return { kind: 'text', value: node.text }
    if (node.description) return { kind: 'description', value: node.description }
  }
  if (node.resourceId) return { kind: 'resourceId', value: node.resourceId }
  if (node.className) return { kind: 'className', value: node.className }
  return null
}

type Preview = { phase: 'idle' | 'loading' } | { phase: 'done'; rows: ListPreviewRow[]; issue: string | null } | { phase: 'error'; message: string }

/** 展示四个必需字段；按身份模式另显示昵称和唯一标识。 */
export function ListClickEditor({ serial, isConnected, value, selectedNode, nodes, onChange }: Props) {
  const [preview, setPreview] = useState<Preview>({ phase: 'idle' })
  const [pickError, setPickError] = useState('')
  useEffect(() => { setPreview({ phase: 'idle' }) }, [value, serial])
  const fields: Field[] = value.mode === 'rowState'
    ? ['container', 'row', 'action', 'completed']
    : ['container', 'row', 'name', 'identity', 'action', 'completed']

  /** 选行时同时记录它相对滚动容器的层级，消除同类名嵌套控件的歧义。 */
  function useNode(field: Field): void {
    if (!selectedNode) return
    try {
      const selector = field === 'row' && value.mode === 'rowState'
        ? suggestedRowSelector(value.container, selectedNode, nodes)
        : fromNode(selectedNode, field, nodes)
      if (!selector) throw new Error('所选控件没有可用的定位属性')
      if (field === 'row' && value.mode === 'rowState') onChange('rowDepth', deriveRowDepth(value.container, selectedNode, nodes))
      if (field === 'container') onChange('rowDepth', undefined)
      onChange(field, selector)
      setPickError('')
    } catch (error) { setPickError(error instanceof Error ? error.message : String(error)) }
  }

  /** 预览不执行关注；配置不完整或出现无法区分的行时如实显示问题。 */
  async function inspect(): Promise<void> {
    setPreview({ phase: 'loading' })
    try {
      // 先一次性列出所有空字段，避免逐项校验只报第一个、用户以为其余都已配好
      const missing = fields.filter((field) => !value[field].value.trim())
      if (missing.length) {
        const hint = missing.includes('row') ? '；用户行请在投屏上选中一条完整用户行后点“使用当前控件”' : ''
        throw new Error(`请先填写：${missing.map((field) => labels[field]).join('、')}${hint}`)
      }
      const step = buildListStep('preview', value)
      validateTask({ version: 1, name: '列表预览', steps: [step] })
      const rows = await window.androidAutoDesk.previewList(serial, step)
      if (!Array.isArray(rows)) throw new Error('手机返回的用户行数据无效')
      setPreview({ phase: 'done', rows, issue: listPreviewIssue(step, rows) })
    } catch (error) { setPreview({ phase: 'error', message: error instanceof Error ? error.message : String(error) }) }
  }

  return <div className="list-click-editor">
    <label className="setting-field">遍历方式<select value={value.mode} onChange={(event) => onChange('mode', event.target.value as ListClickDraft['mode'])}>
      <option value="rowState">按行状态遍历（无需昵称和 ID）</option><option value="identity">按唯一标识遍历</option>
    </select></label>
    <p>先拾取滚动容器，再拾取其中一条完整用户行（两种遍历方式都需要用户行）。随后拾取“关注”控件；“已关注”可手填尚未出现的文字或描述。</p>
    {fields.map((field) => <div className={preview.phase === 'error' && !value[field].value.trim() ? 'list-field list-field-missing' : 'list-field'} key={field}>
      <strong>{labels[field]}</strong>
      <select aria-label={`${labels[field]}定位方式`} value={value[field].kind} onChange={(event) => onChange(field, { kind: event.target.value as Selector['kind'], value: value[field].value })}>
        <option value="resourceId">资源 ID</option><option value="description">描述</option><option value="text">文字</option><option value="className">类名</option>
      </select>
      <input aria-label={labels[field]} value={value[field].value} placeholder={`填写${labels[field]}定位值`} onChange={(event) => onChange(field, { ...value[field], value: event.target.value })} />
      <button type="button" disabled={!selectedNode} onClick={() => useNode(field)}>使用当前控件</button>
    </div>)}
    {pickError && <p className="list-preview-error" role="alert">{pickError}</p>}
    {value.mode === 'rowState' && <p>用户行层级：{value.rowDepth ?? '未确定'}。请用“用户行”的“使用当前控件”自动录入；无法读取昵称和 ID 时不必填写。</p>}
    <label className="setting-field">滚动容器第几个匹配项（可选）<input type="number" min="1" max="10000" value={value.container.matchIndex ?? ''} placeholder="留空要求唯一匹配" onChange={(event) => { onChange('container', { ...value.container, matchIndex: event.target.value ? Number(event.target.value) : undefined }); onChange('rowDepth', undefined) }} /></label>
    {value.mode === 'identity' && <p>名称用于日志；唯一标识必须对每位用户稳定且唯一。两者可使用同一个无重名的名称控件。</p>}
    <label className="setting-field">最多滚动次数（1–1000）<input type="number" min="1" max="1000" value={value.maxScrolls} onChange={(event) => onChange('maxScrolls', Number(event.target.value))} /></label>
    <label className="setting-field">点击后确认超时（毫秒）<input type="number" min="100" max="60000" value={value.timeoutMs} onChange={(event) => onChange('timeoutMs', Number(event.target.value))} /></label>
    <button type="button" disabled={!isConnected || preview.phase === 'loading'} onClick={() => void inspect()}>{preview.phase === 'loading' ? '正在预览…' : '预览当前屏（只读取）'}</button>
    {preview.phase === 'error' && <p className="list-preview-error" role="alert">预览失败：{preview.message}</p>}
    {preview.phase === 'done' && <div className="list-preview" role="status">
      <strong>当前屏识别 {preview.rows.length} 行</strong>
      {preview.rows.map((row, index) => <div className="list-preview-row" key={index}>
        <span>第 {index + 1} 行</span>
        <span>{'status' in row ? ({ pending: '待关注', completed: '已关注', missing: '未识别状态', ambiguous: '状态含糊' })[row.status] : row.name || '未命名'}</span>
        <small className={row.error ? 'list-preview-error' : ''}>{row.error || (row.deferred ? '边缘不完整，下一屏再处理' : '')}</small>
      </div>)}
      {preview.issue && <p className="list-preview-error" role="alert">{preview.issue}</p>}
    </div>}
  </div>
}
