/**
 * 目标应用选择器：支持常用应用搜索、自定义包名输入及完整键盘操作。
 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent } from 'react'
import { appPackageLabel, filterAppPackages, resolveAppPackage } from '../utils/app-packages'
import './app-package-select.css'

type AppPackageSelectProps = {
  value: string
  onChange: (packageName: string) => void
}

/**
 * 编辑时显示真实包名，离开控件后用应用名帮助识别预置应用。
 * @param props 当前任务包名与提交回调
 * @returns 带搜索列表的可选包名字段
 */
export function AppPackageSelect({ value, onChange }: AppPackageSelectProps) {
  const id = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const anchorRef = useRef<HTMLDivElement>(null)
  const isComposing = useRef(false)
  const [isFocused, setFocused] = useState(false)
  const [isOpen, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({})
  const options = filterAppPackages(query)
  const activeOption = isOpen ? options[activeIndex] : undefined

  useEffect(() => {
    // 加载任务或前台应用回填必须覆盖旧草稿，避免失焦后写回过期包名。
    setDraft(value)
    setQuery('')
    setActiveIndex(-1)
  }, [value])

  useLayoutEffect(() => {
    if (!isOpen) return
    /** 按视口剩余空间选择展开方向，避免列表被右栏滚动容器裁切。 */
    function positionMenu(): void {
      const rect = anchorRef.current?.getBoundingClientRect()
      if (!rect) return
      const gap = 6 // 输入框与下拉列表之间的视觉间距
      const margin = 12 // 列表距窗口边缘的最小留白
      const below = window.innerHeight - rect.bottom - gap - margin
      const above = rect.top - gap - margin
      const isAbove = below < 220 && above > below
      setMenuStyle({
        left: rect.left,
        width: rect.width,
        maxHeight: Math.max(0, Math.min(240, isAbove ? above : below)),
        ...(isAbove ? { bottom: window.innerHeight - rect.top + gap } : { top: rect.bottom + gap })
      })
    }
    positionMenu()
    window.addEventListener('resize', positionMenu)
    window.addEventListener('scroll', positionMenu, true)
    const observer = new ResizeObserver(positionMenu)
    if (anchorRef.current) observer.observe(anchorRef.current)
    return () => {
      window.removeEventListener('resize', positionMenu)
      window.removeEventListener('scroll', positionMenu, true)
      observer.disconnect()
    }
  }, [isOpen])

  useEffect(() => {
    if (activeOption) document.getElementById(`${id}-option-${activeIndex}`)?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, activeOption, id])

  /** 展开时清除筛选，让已选择应用的用户也能直接改选其他应用。 */
  function openMenu(): void {
    setQuery('')
    setActiveIndex(-1)
    setOpen(true)
  }

  /**
   * 统一提交选项与手工输入，之后失焦可重复提交同值而不改变任务。
   * @param text 要提交的应用名或包名
   */
  function commit(text: string): void {
    const packageName = resolveAppPackage(text)
    setDraft(packageName)
    setQuery('')
    setActiveIndex(-1)
    setOpen(false)
    if (packageName !== value) onChange(packageName)
  }

  /**
   * 仅显式导航的高亮项可被 Enter 选中，避免搜索文本被第一项静默替换。
   * @param event 输入框键盘事件
   */
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    // 输入法确认候选词同样会产生 Enter，不能提前提交包名。
    if (isComposing.current || event.nativeEvent.isComposing || event.keyCode === 229) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!isOpen) {
        openMenu()
        return
      }
      if (!options.length) return
      const next = event.key === 'ArrowDown' ? 1 : -1
      setActiveIndex((current) => current < 0 ? (next > 0 ? 0 : options.length - 1) : (current + next + options.length) % options.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      commit(activeOption?.packageName ?? draft)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setDraft(value)
      setQuery('')
      setActiveIndex(-1)
      setOpen(false)
    }
    // Tab 使用原生焦点移动并提交；附属按钮不占用 Tab 顺序。
  }

  return <div className="setting-field app-package-field" onBlur={(event) => {
    if (event.currentTarget.contains(event.relatedTarget)) return
    commit(draft)
    setFocused(false)
  }}>
    <label htmlFor={`${id}-input`}>目标 App 包名 <span className="optional">（可选）</span></label>
    <div className="app-package-control" ref={anchorRef}>
      <input id={`${id}-input`} ref={inputRef} role="combobox" autoComplete="off" spellCheck={false}
        aria-autocomplete="list" aria-expanded={isOpen} aria-controls={isOpen ? `${id}-list` : undefined}
        aria-activedescendant={activeOption ? `${id}-option-${activeIndex}` : undefined}
        aria-describedby={`${id}-hint`} placeholder="选择 App 或输入包名"
        value={isFocused ? draft : appPackageLabel(value)}
        onFocus={() => {
          setFocused(true)
          openMenu()
          // 等真实包名完成渲染后再选中文字，确保可以一次替换完整包名。
          requestAnimationFrame(() => inputRef.current?.select())
        }}
        onClick={() => { if (!isOpen) openMenu() }}
        onChange={(event) => {
          setDraft(event.target.value)
          setQuery(event.target.value)
          setActiveIndex(-1)
          setOpen(true)
        }}
        onCompositionStart={() => { isComposing.current = true }}
        onCompositionEnd={() => { isComposing.current = false }}
        onKeyDown={handleKeyDown}
      />
      <div className="app-package-buttons">
        {(isFocused ? draft : value) && <button type="button" tabIndex={-1} aria-label="清空目标 App 包名"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => { commit(''); inputRef.current?.focus(); setOpen(false) }}>×</button>}
        <button type="button" tabIndex={-1} aria-label={isOpen ? '收起常用 App' : '展开常用 App'} aria-expanded={isOpen}
          aria-controls={isOpen ? `${id}-list` : undefined}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            const wasOpen = isOpen
            inputRef.current?.focus()
            if (wasOpen) setOpen(false)
            else openMenu()
          }}><span aria-hidden="true">{isOpen ? '⌃' : '⌄'}</span></button>
      </div>
    </div>
    {isOpen && <ul id={`${id}-list`} className="app-package-menu" style={menuStyle}
      role="listbox" aria-label="常用 App"
      onMouseDown={(event) => event.preventDefault()}>
      {options.map((app, index) => <li key={app.packageName} id={`${id}-option-${index}`} role="option"
        aria-selected={app.packageName === value}
        className={`app-package-option${activeIndex === index ? ' active' : ''}`}
        onMouseMove={() => setActiveIndex(index)}
        onClick={() => commit(app.packageName)}>
        <span><strong>{app.name}</strong><small>{app.packageName}</small></span>
        {app.packageName === value && <span className="app-package-check" aria-hidden="true">✓</span>}
      </li>)}
      {!options.length && <li className="app-package-empty" role="presentation">无匹配应用，可直接输入完整包名</li>}
    </ul>}
    <p id={`${id}-hint`} className="app-package-hint">支持选择常用 App 或输入包名；留空则不自动启动应用</p>
  </div>
}
