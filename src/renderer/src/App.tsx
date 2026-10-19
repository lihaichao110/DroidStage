/**
 * 应用组合层：设备连接、快照检视与任务编辑/运行的页面骨架。
 */
import { useEffect, useState } from 'react'
import type { AutomationTask, Device, HierarchySnapshot, Point, RunEvent, Selector, Step, UiNode } from '../../shared/types'
import { crossAppWarning, suggestedSelector, validateTask } from '../../shared/task'
import { InspectorPanel } from './components/inspector-panel'

type EditorAction = Step['type']
const defaultTask: AutomationTask = { version: 1, name: '新任务', packageName: '', steps: [] }

export default function App() {
  const [devices, setDevices] = useState<Device[]>([])
  const [serial, setSerial] = useState('')
  const [connected, setConnected] = useState(false)
  const [snapshot, setSnapshot] = useState<HierarchySnapshot | null>(null)
  const [selectedNode, setSelectedNode] = useState<UiNode | null>(null)
  const [selectedPoint, setSelectedPoint] = useState<Point | null>(null)
  const [selector, setSelector] = useState<Selector | null>(null)
  const [task, setTask] = useState<AutomationTask>(defaultTask)
  const [action, setAction] = useState<EditorAction>('tap')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [timeout, setTimeoutValue] = useState(10000)
  const [exists, setExists] = useState(true)
  const [key, setKey] = useState<'back' | 'home'>('back')
  const [swipeFrom, setSwipeFrom] = useState<Point>({ x: 300, y: 700 })
  const [swipeTo, setSwipeTo] = useState<Point>({ x: 300, y: 300 })
  const [swipeDuration, setSwipeDuration] = useState(500)
  const [busy, setBusy] = useState(false)
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState('连接 USB 手机后开始。')
  const [events, setEvents] = useState<RunEvent[]>([])

  useEffect(() => {
    void restoreOnMount()
    return window.androidAutoDesk.onRunEvent((event) => setEvents((previous) => [...previous, event]))
  }, [])

  /**
   * 页面重载（dev HMR / 手动刷新）后 React 状态归零，但主进程里的设备会话仍然存活；
   * 查询主进程连接态并恢复，投屏会随 connected 状态自动重启。
   */
  async function restoreOnMount(): Promise<void> {
    try {
      await refreshDevices()
      const state = await window.androidAutoDesk.sessionState()
      if (!state.connected) return
      setConnected(true)
      setMessage('已恢复与手机的连接。')
      await refreshSnapshot()
    } catch (error) { setMessage(errorText(error)) }
  }

  async function refreshDevices(): Promise<void> {
    try {
      const list = await window.androidAutoDesk.listDevices()
      setDevices(list)
      setSerial((current) => list.some((device) => device.serial === current) ? current : list[0]?.serial ?? '')
      setMessage(list.length ? '选择设备并连接。' : '未检测到设备。请检查 USB 调试授权；Windows 还可能需要厂商驱动。')
    } catch (error) { setMessage(errorText(error)) }
  }

  async function connect(): Promise<void> {
    if (!serial) return
    setBusy(true)
    try {
      await window.androidAutoDesk.connect(serial)
      setConnected(true)
      setMessage('连接成功，正在读取页面。')
      await refreshSnapshot()
    } catch (error) {
      setConnected(false)
      setMessage(errorText(error))
    } finally { setBusy(false) }
  }

  async function disconnect(): Promise<void> {
    setBusy(true)
    try { await window.androidAutoDesk.disconnect() } catch (error) { setMessage(errorText(error)) }
    setConnected(false)
    setSnapshot(null)
    setSelectedNode(null)
    setSelector(null)
    setBusy(false)
  }

  async function refreshSnapshot(): Promise<void> {
    try {
      const result = await window.androidAutoDesk.snapshot()
      setSnapshot(result)
      setSelectedNode(null)
      setSelectedPoint(null)
      setSelector(null)
      // 包名留空时用当前前台应用的包名回填（控件树第一个根节点的 package 属性），
      // 录制时用户通常停在目标 App 界面，自动填入可省去手查包名；回填后给出提示，用户可清空改为不启动 App
      const foreground = result.nodes.find((node) => node.depth === 0 && node.packageName)?.packageName
      const isBackfilled = Boolean(foreground && !task.packageName)
      if (foreground) setTask((current) => current.packageName ? current : { ...current, packageName: foreground })
      setMessage(isBackfilled
        ? `已读取 ${result.nodes.length} 个控件；已自动填入当前前台应用：${foreground}（留空则运行时不启动 App）`
        : `已读取 ${result.nodes.length} 个控件。`)
    } catch (error) { setMessage(errorText(error)) }
  }

  function selectNode(node: UiNode | null, point: Point | null): void {
    setSelectedNode(node)
    setSelectedPoint(point)
    setSelector(node ? suggestedSelector(node) : null)
  }

  async function addStep(): Promise<void> {
    try {
      const id = editingId ?? crypto.randomUUID()
      let step: Step
      if (action === 'tap') {
        if (selector) {
          const count = await window.androidAutoDesk.count(selector)
          if (count !== 1) throw new Error(`当前定位条件匹配 ${count} 个控件，需要恰好 1 个`)
          step = { id, type: 'tap', selector, timeoutMs: timeout }
        } else if (selectedPoint) {
          step = { id, type: 'tap', point: selectedPoint, timeoutMs: timeout }
          setMessage('已添加坐标点击。页面布局变化时可能失效。')
        } else throw new Error('先在投屏（拾取模式）或控件树中选择目标')
      } else if (action === 'input') {
        if (!selector) throw new Error('输入步骤必须选择可定位控件')
        const count = await window.androidAutoDesk.count(selector)
        if (count !== 1) throw new Error(`当前定位条件匹配 ${count} 个控件，需要恰好 1 个`)
        step = { id, type: 'input', selector, text, timeoutMs: timeout }
      } else if (action === 'swipe') {
        step = { id, type: 'swipe', from: swipeFrom, to: swipeTo, durationMs: swipeDuration }
      } else if (action === 'wait' || action === 'assert') {
        if (!selector) throw new Error('先选择可定位控件')
        const count = await window.androidAutoDesk.count(selector)
        if (count > 1) throw new Error(`当前定位条件匹配 ${count} 个控件，需要更具体的定位条件`)
        step = action === 'wait' ? { id, type: 'wait', selector, exists, timeoutMs: timeout } : { id, type: 'assert', selector, exists }
      } else if (action === 'screenshot') {
        step = { id, type: 'screenshot' }
      } else {
        step = { id, type: 'key', key }
      }
      const next = { ...task, steps: editingId ? task.steps.map((item) => item.id === editingId ? step : item) : [...task.steps, step] }
      validateTask(next)
      setTask(next)
      setEditingId(null)
      // 只对按控件定位的步骤做跨应用提醒：坐标点击已有布局变化风险提示，swipe/key/screenshot 不涉及控件归属
      const warning = ('selector' in step && step.selector) ? crossAppWarning(selectedNode?.packageName, task.packageName?.trim()) : null
      if (warning) setMessage(warning)
      else if (action !== 'tap' || selector) setMessage(editingId ? '步骤已修改。' : '步骤已添加。')
    } catch (error) { setMessage(errorText(error)) }
  }

  function editStep(step: Step): void {
    setEditingId(step.id)
    setAction(step.type)
    setSelectedNode(null)
    setSelector('selector' in step ? step.selector ?? null : null)
    setSelectedPoint(step.type === 'tap' ? step.point ?? null : null)
    if ('timeoutMs' in step) setTimeoutValue(step.timeoutMs)
    if (step.type === 'input') setText(step.text)
    if (step.type === 'wait' || step.type === 'assert') setExists(step.exists)
    if (step.type === 'swipe') { setSwipeFrom(step.from); setSwipeTo(step.to); setSwipeDuration(step.durationMs) }
    if (step.type === 'key') setKey(step.key)
    setMessage('正在修改步骤；选择新控件可替换原定位条件。')
  }

  function moveStep(index: number, offset: number): void {
    const target = index + offset
    if (target < 0 || target >= task.steps.length) return
    const steps = [...task.steps]
      ;[steps[index], steps[target]] = [steps[target], steps[index]]
    setTask({ ...task, steps })
  }

  async function save(): Promise<void> {
    try { validateTask(task); const file = await window.androidAutoDesk.saveTask(task); if (file) setMessage(`已保存：${file}`) }
    catch (error) { setMessage(errorText(error)) }
  }

  async function load(): Promise<void> {
    try { const result = await window.androidAutoDesk.loadTask(); if (result) { setTask(result); setEditingId(null); setMessage('任务已载入。') } }
    catch (error) { setMessage(errorText(error)) }
  }

  async function run(): Promise<void> {
    try {
      validateTask(task)
      if (!task.steps.length) throw new Error('请先添加至少一个步骤')
      setEvents([])
      setRunning(true)
      await window.androidAutoDesk.runTask(task)
      setMessage('任务完成。')
    } catch (error) { setMessage(errorText(error)) }
    finally { setRunning(false) }
  }

  return <div className="app">
    <header className="topbar">
      <div><h1>AndroidAutoDesk</h1><p>安卓可视化自动化 · USB / UI Automator</p></div>
      <div className="device-controls">
        <select aria-label="设备" value={serial} onChange={(event) => setSerial(event.target.value)} disabled={busy || connected}>
          {devices.length === 0 && <option value="">无设备</option>}
          {devices.map((device) => <option key={device.serial} value={device.serial}>{device.model || device.serial} · {device.state}</option>)}
        </select>
        <button onClick={() => void refreshDevices()} disabled={busy || running}>刷新设备</button>
        {connected ? <button onClick={() => void disconnect()} disabled={busy || running}>断开</button> : <button className="primary" onClick={() => void connect()} disabled={busy || !serial}>连接</button>}
      </div>
    </header>

    <div className="status" role="status">{message} {message.includes('驱动') && <a href="https://developer.android.com/studio/run/oem-usb" target="_blank" rel="noreferrer">厂商驱动说明</a>}</div>

    <main className="workspace">
      <InspectorPanel
        snapshot={snapshot}
        selectedNode={selectedNode}
        selectedPoint={selectedPoint}
        selector={selector}
        isConnected={connected}
        isBusy={busy}
        isTaskRunning={running}
        onRefresh={() => void refreshSnapshot()}
        onSelect={selectNode}
        onSelectorChange={setSelector}
      />

      <section className="panel editor">
        <div className="panel-head"><h2>任务编辑</h2><div><button onClick={() => void load()}>打开</button><button onClick={() => void save()}>保存</button></div></div>
        <div className="fields two"><label>任务名称<input value={task.name} onChange={(event) => setTask({ ...task, name: event.target.value })} /></label><label>目标 App 包名（可选）<input placeholder="留空则不自动启动 App，连接后自动填入前台应用" value={task.packageName ?? ''} onChange={(event) => setTask({ ...task, packageName: event.target.value.trim() })} /></label></div>
        <div className="divider" />
        <h3>添加步骤</h3>
        <div className="fields two"><label>动作<select value={action} onChange={(event) => setAction(event.target.value as EditorAction)}>
          <option value="tap">点击</option><option value="input">输入文本</option><option value="swipe">滑动</option><option value="wait">等待控件</option><option value="assert">断言控件</option><option value="screenshot">保存截图</option><option value="key">返回 / Home</option>
        </select></label>
          {(action === 'tap' || action === 'input' || action === 'wait') && <label>超时（毫秒）<input type="number" min="100" max="60000" value={timeout} onChange={(event) => setTimeoutValue(Number(event.target.value))} /></label>}</div>
        {action === 'input' && <label className="field">输入内容<textarea rows={2} value={text} onChange={(event) => setText(event.target.value)} /></label>}
        {(action === 'wait' || action === 'assert') && <label className="field">条件<select value={exists ? 'present' : 'absent'} onChange={(event) => setExists(event.target.value === 'present')}><option value="present">控件存在且唯一</option><option value="absent">控件不存在</option></select></label>}
        {action === 'key' && <label className="field">按键<select value={key} onChange={(event) => setKey(event.target.value as 'back' | 'home')}><option value="back">返回</option><option value="home">Home</option></select></label>}
        {action === 'swipe' && <div className="fields swipe-fields">
          <label>起点 X<input type="number" value={swipeFrom.x} onChange={(event) => setSwipeFrom({ ...swipeFrom, x: Number(event.target.value) })} /></label>
          <label>起点 Y<input type="number" value={swipeFrom.y} onChange={(event) => setSwipeFrom({ ...swipeFrom, y: Number(event.target.value) })} /></label>
          <label>终点 X<input type="number" value={swipeTo.x} onChange={(event) => setSwipeTo({ ...swipeTo, x: Number(event.target.value) })} /></label>
          <label>终点 Y<input type="number" value={swipeTo.y} onChange={(event) => setSwipeTo({ ...swipeTo, y: Number(event.target.value) })} /></label>
          <label>时长 ms<input type="number" value={swipeDuration} onChange={(event) => setSwipeDuration(Number(event.target.value))} /></label>
        </div>}
        <div className="edit-actions"><button className="primary add" onClick={() => void addStep()} disabled={!connected && ['tap', 'input', 'wait', 'assert'].includes(action)}>{editingId ? '保存修改' : '添加步骤'}</button>{editingId && <button onClick={() => setEditingId(null)}>取消修改</button>}</div>
        <div className="divider" />
        <h3>步骤（{task.steps.length}）</h3>
        <div className="steps">
          {task.steps.length === 0 && <p className="muted">连接后在左侧投屏切到拾取模式点选目标，或从控件树选中，再添加步骤。</p>}
          {task.steps.map((step, index) => <div className="step" key={step.id}><span className="step-index">{index + 1}</span><span className="step-label">{stepLabel(step)}</span><div className="step-actions"><button onClick={() => editStep(step)} disabled={running}>编辑</button><button aria-label="上移" onClick={() => moveStep(index, -1)} disabled={index === 0 || running}>↑</button><button aria-label="下移" onClick={() => moveStep(index, 1)} disabled={index === task.steps.length - 1 || running}>↓</button><button aria-label="删除" onClick={() => setTask({ ...task, steps: task.steps.filter((item) => item.id !== step.id) })} disabled={running}>×</button></div></div>)}
        </div>
        <div className="runbar"><button className="primary" disabled={!connected || running || !task.steps.length || Boolean(editingId)} onClick={() => void run()}>运行任务</button><button disabled={!running} onClick={() => void window.androidAutoDesk.cancelRun()}>完成当前步骤后取消</button></div>
        <h3>运行记录</h3><div className="log">{events.length === 0 ? <span className="muted">尚无运行记录</span> : events.map((event, index) => <div key={index} className={`log-${event.kind}`}><time>{new Date(event.at).toLocaleTimeString()}</time> {event.message}{event.runDir && ['success', 'failure', 'cancelled'].includes(event.kind) && <button className="open-result" onClick={() => void window.androidAutoDesk.openRunDir(event.runDir!)}>打开结果目录</button>}</div>)}</div>
      </section>
    </main>
  </div>
}

function stepLabel(step: Step): string {
  switch (step.type) {
    case 'tap': return `点击 ${step.selector ? `${step.selector.kind}: ${step.selector.value}` : `坐标 (${step.point?.x}, ${step.point?.y})`}`
    case 'input': return `输入 ${step.selector.kind}: ${step.selector.value} · ${step.text.length} 字`
    case 'swipe': return `滑动 (${step.from.x}, ${step.from.y}) → (${step.to.x}, ${step.to.y})`
    case 'wait': return `等待控件${step.exists ? '出现' : '消失'}：${step.selector.value}`
    case 'assert': return `断言控件${step.exists ? '存在' : '不存在'}：${step.selector.value}`
    case 'screenshot': return '保存截图'
    case 'key': return step.key === 'back' ? '返回' : 'Home'
  }
}

function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error) }
