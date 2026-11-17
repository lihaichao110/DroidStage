/**
 * 设备管理组件共用的会话视图类型与地址编辑请求。
 */
import type { useDeviceFleet } from '../hooks/use-device-fleet'

export type DeviceFleet = ReturnType<typeof useDeviceFleet>
export type ConnectionMode = 'usb' | 'wireless' | 'companion'
export type AddressRequest = { serial: string; revision: number }
