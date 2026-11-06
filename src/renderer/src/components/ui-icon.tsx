/**
 * 工作台线性图标：统一导航、工具栏和编辑面板的图形语言。
 */
import type { CSSProperties } from 'react'

const paths = {
  edit: 'M16 3l5 5M4 16L16 4a2 2 0 013 3L7 19l-4 1 1-4zM12 4H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7',
  phone: 'M7 2h10a1 1 0 011 1v18a1 1 0 01-1 1H7a1 1 0 01-1-1V3a1 1 0 011-1zM11 18h2',
  play: 'M6 3l15 9L6 21V3z',
  file: 'M14 2H5v20h14V7l-5-5zM14 2v6h5',
  folder: 'M3 6h6l2 2h10v13H3V6zM3 6V3h6l2 3h8v2',
  save: 'M4 3h14l3 3v15H3V3h1zM7 3v6h10V3M7 21v-8h10v8',
  flow: 'M12 3v6M5 15v-5h14v5M9 2h6v4H9V2zM2 16h6v6H2v-6zM16 16h6v6h-6v-6z',
  settings: 'M9 3l1-2h4l1 2 3 2 2 0 2 4-2 2v3l2 2-2 4h-3l-2 2h-5l-1-2-3-1H3l-2-4 2-2v-3L1 8l2-4h3l3-1zM16 12a4 4 0 11-8 0 4 4 0 018 0z',
  link: 'M10 14l4-4M8 16l-1 1a4 4 0 01-6-6l5-5a4 4 0 016 0M16 8l1-1a4 4 0 016 6l-5 5a4 4 0 01-6 0',
  unlink: 'M8 16l-1 1a4 4 0 01-6-6l3-3M16 8l1-1a4 4 0 016 6l-3 3M2 2l20 20M8 2l2 2M2 8l2 2M20 14l2 2M14 20l2 2',
  scan: 'M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5M9 9h6v6H9V9z',
  pointer: 'M5 2l15 12-7 1-3 7L5 2z',
  plus: 'M12 3v18M3 12h18',
  refresh: 'M20 7V2l-4 4M20 7a9 9 0 10.5 9M20 7h-5',
  more: 'M4 12h.01M12 12h.01M20 12h.01',
  down: 'M6 9l6 6 6-6',
  check: 'M5 12l4 4L19 6',
  tap: 'M9 13V6a3 3 0 016 0v5l4 2v5a4 4 0 01-4 4h-3l-6-6a2 2 0 013-3z',
  keyboard: 'M2 5h20v14H2V5zM6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M10 13h.01M14 13h.01M18 13h.01M8 16h8',
  swipe: 'M12 2v20M7 7l5-5 5 5M7 17l5 5 5-5',
  clock: 'M21 12a9 9 0 11-18 0 9 9 0 0118 0zM12 6v6l4 2',
  branch: 'M12 2l10 10-10 10L2 12 12 2z',
  list: 'M7 5h14M7 12h14M7 19h14M3 5h.01M3 12h.01M3 19h.01',
  camera: 'M3 6h4l2-3h6l2 3h4v15H3V6zM16 13a4 4 0 11-8 0 4 4 0 018 0z',
  back: 'M9 4l-6 6 6 6M3 10h12a6 6 0 010 12'
} as const

export type IconName = keyof typeof paths

/**
 * 按语义输出装饰性图标；可操作元素的可访问名称由父按钮提供。
 * @param props 图标名称、像素尺寸和可选的旋转等样式
 * @returns 不重复播报的 SVG 图标
 */
export function UiIcon({ name, size = 22, style }: { name: IconName; size?: number; style?: CSSProperties }) {
  return <svg className="ui-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}><path d={paths[name]} /></svg>
}
