/**
 * 设备行菜单：浮层避免被表格裁剪，并支持键盘与外部关闭。
 */
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Device } from '../../../shared/types'
import { UiIcon } from './ui-icon'

type Props = { device: Device; canFocus: boolean; onFocus: () => void; onEditAddress: () => void }

/**
 * 菜单仅在打开时挂载，滚动时关闭，避免与原设备行错位。
 * @param props 设备信息、编辑权限和低频操作回调
 * @returns 菜单按钮及打开后的可访问浮层
 */
export function DeviceRowMenu({ device, canFocus, onFocus, onEditAddress }: Props) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!position) return
    const firstItem = menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')
    if (firstItem) firstItem.focus()
    else menu.current?.focus()
    /** 外部点击不抢走新目标焦点，Esc 则还给菜单按钮。 */
    function outside(event: PointerEvent): void {
      if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setPosition(null)
    }
    function escape(event: KeyboardEvent): void {
      if (event.key === 'Escape') { event.preventDefault(); setPosition(null); trigger.current?.focus() }
    }
    function scroll(event: Event): void {
      if (!menu.current?.contains(event.target as Node)) setPosition(null)
    }
    function close(): void { setPosition(null) }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    window.addEventListener('scroll', scroll, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
      window.removeEventListener('scroll', scroll, true)
      window.removeEventListener('resize', close)
    }
  }, [position])

  /** 根据视口放置菜单，避免最后几行被底栏遮挡。 */
  function open(): void {
    const rect = trigger.current?.getBoundingClientRect()
    if (rect) setPosition({ left: Math.max(8, Math.min(rect.right - 180, window.innerWidth - 188)), top: Math.max(8, Math.min(rect.bottom + 5, window.innerHeight - 140)) })
  }

  /** 地址定位的后续 effect 会接管输入焦点。 */
  function select(callback: () => void): void {
    setPosition(null)
    trigger.current?.focus()
    callback()
  }

  return <>
    <button ref={trigger} className="device-more" aria-label={`${device.model || device.serial} 的更多操作`} aria-haspopup="menu" aria-expanded={Boolean(position)} aria-controls={position ? menuId : undefined}
      onClick={() => position ? setPosition(null) : open()} onKeyDown={(event) => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); open() } }}><UiIcon name="more" size={18} /></button>
    {position && createPortal(<div ref={menu} id={menuId} className="device-action-menu" role="menu" aria-label="设备操作" style={position} tabIndex={-1}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setPosition(null) }}
      onKeyDown={(event) => {
        const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
        const index = items.indexOf(document.activeElement as HTMLButtonElement)
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault()
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
          items[next]?.focus()
        }
      }}>
      <button role="menuitem" disabled={!canFocus} onClick={() => select(onFocus)}><UiIcon name="edit" size={16} />设为编辑设备</button>
      {device.transport === 'companion' && <button role="menuitem" onClick={() => select(onEditAddress)}><UiIcon name="refresh" size={16} />更新地址</button>}
    </div>, document.body)}
  </>
}
