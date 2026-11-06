/**
 * 设备未连接占位：用手机轮廓提示真实连接状态并提供设备管理入口。
 */
import { UiIcon } from './ui-icon'

/**
 * 未连接时只提供连接入口，不显示任何伪造设备画面。
 * @param props 打开设备管理页的回调
 * @returns 手机轮廓与连接入口
 */
export function DeviceEmptyState({ onConnect }: { onConnect: () => void }) {
  return <div className="device-empty-state">
    <div className="phone-placeholder" aria-hidden="true"><span className="phone-camera" /><UiIcon name="unlink" size={42} /><span>未连接设备</span></div>
    <button className="primary connect-device" onClick={onConnect}><UiIcon name="link" size={20} />连接设备</button>
  </div>
}
