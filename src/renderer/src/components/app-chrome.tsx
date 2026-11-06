/**
 * 公共导航与状态栏：展示当前页面、真实连接状态和可展开的完整操作反馈。
 */
import droidstageIcon from '../assets/droidstage-icon.png'
import { UiIcon, type IconName } from './ui-icon'

export type Page = 'editor' | 'devices' | 'monitor'
const PAGES: { id: Page; label: string; icon: IconName }[] = [
  { id: 'editor', label: '任务编辑', icon: 'edit' },
  { id: 'devices', label: '设备管理', icon: 'phone' },
  { id: 'monitor', label: '运行工作台', icon: 'play' }
]

/**
 * 保留运行中提示，使切页后仍能识别后台任务。
 * @param props 当前页面、真实连接数量和导航回调
 * @returns 公共导航栏
 */
export function AppHeader({ page, count, isRunning, onSwitch }: { page: Page; count: number; isRunning: boolean; onSwitch: (page: Page) => void }) {
  return <header className="topbar">
    <div className="brand"><img src={droidstageIcon} alt="" /><h1>卓序</h1></div>
    <span className="top-separator" aria-hidden="true" />
    <nav className="page-tabs" aria-label="主页面">
      {PAGES.map((item) => <button key={item.id} className={page === item.id ? 'active' : ''} aria-current={page === item.id ? 'page' : undefined} onClick={() => onSwitch(item.id)}>
        <UiIcon name={item.icon} />{item.label}{item.id === 'monitor' && isRunning && <span className="nav-live" />}
      </button>)}
    </nav>
    <div className="top-summary"><span>{count} 台已连接</span><span className={isRunning ? 'running' : ''}>{isRunning ? '任务运行中' : '空闲'}</span></div>
  </header>
}

/**
 * 完整反馈使用原生展开控件，长错误不会因底栏省略而无法阅读。
 * @param props 真实连接数量和最近操作反馈
 * @returns 可展开反馈的底部状态栏
 */
export function AppStatus({ count, message }: { count: number; message: string }) {
  return <footer className="app-status" role="status">
    <span className={`status-connection${count ? ' connected' : ''}`}><UiIcon name={count ? 'link' : 'unlink'} size={19} />{count ? `已连接 ${count} 台设备` : '未连接设备'}</span>
    <details className="status-message" key={message}>
      <summary title={message}>{message}</summary>
      <div className="status-full">{message}{message.includes('驱动') && <a href="https://developer.android.com/studio/run/oem-usb" target="_blank" rel="noreferrer">厂商驱动说明</a>}</div>
    </details>
  </footer>
}
