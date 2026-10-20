/**
 * 无线 ADB：校验手机显示的端点，并执行配对与连接。
 */
import { adb, listDevices } from './adb'
import { isIP } from 'node:net'

const LEGACY_PORT = 5555 // 旧版 Android 通过 USB 启用 ADB TCP/IP 后使用的端口

/** 校验旧版无线入口的手机 IP；只接受 IPv4，避免误把端口或参数写进地址。 */
export function validateLegacyIp(ip: string): string {
  const address = ip.trim()
  if (isIP(address) !== 4) throw new Error('请输入手机的 IPv4 地址，例如 192.168.1.10')
  return address
}

/** 校验 IP 或主机名和端口，避免用户输入被当成额外 ADB 参数。 */
export function validateEndpoint(address: string): string {
  const value = address.trim()
  const match = /^(\[[0-9a-fA-F:]+\]|[a-zA-Z0-9.-]+):(\d{1,5})$/.exec(value)
  const port = Number(match?.[2])
  if (!match || !Number.isInteger(port) || port < 1 || port > 65535 || value.startsWith('-')) {
    throw new Error('请输入手机显示的 IP 地址和端口，例如 192.168.1.10:37123')
  }
  return value
}

/** 使用手机上的六位配对码配对；配对码不进入持久化日志。 */
export async function pairWireless(address: string, code: string): Promise<void> {
  const endpoint = validateEndpoint(address)
  if (!/^\d{6}$/.test(code.trim())) throw new Error('请输入手机显示的 6 位配对码')
  const output = (await adb(['pair', endpoint, code.trim()], 15000)).toString('utf8')
  if (!/successfully paired/i.test(output)) throw new Error(output.trim() || '无线配对失败')
}

/** 连接已配对设备，并确认它出现在 ADB 在线设备列表。 */
export async function connectWireless(address: string): Promise<void> {
  const endpoint = validateEndpoint(address)
  const output = (await adb(['connect', endpoint], 15000)).toString('utf8')
  if (!/connected to/i.test(output)) throw new Error(output.trim() || '无线设备连接失败')
  const device = (await listDevices()).find((item) => item.serial === endpoint)
  if (!device || device.state !== 'device') throw new Error(`无线设备 ${endpoint} 未就绪，请检查无线调试与网络`)
}

/**
 * 用已授权的 USB 设备启用旧版 ADB TCP/IP，并确认无线序列号在线。
 * @param serial 当前 USB 序列号
 * @param ip 手机在局域网中的 IP 地址
 * @returns 无线序列号及设备实际 Android API 等级
 * @throws USB 未授权、IP 无效或无线连接失败时抛出
 */
export async function enableLegacyWireless(serial: string, ip: string): Promise<{ serial: string; sdk: number }> {
  const address = validateLegacyIp(ip)
  const usbDevice = (await listDevices()).find((device) => device.serial === serial && device.usb)
  if (!usbDevice || usbDevice.state !== 'device') throw new Error('请先通过 USB 连接手机并允许调试授权')
  const sdk = Number((await adb(['-s', serial, 'shell', 'getprop', 'ro.build.version.sdk'])).toString('utf8').trim())
  if (!Number.isInteger(sdk) || sdk < 1) throw new Error('无法读取手机的 Android API 等级')
  const endpoint = `${address}:${LEGACY_PORT}`
  await adb(['-s', serial, 'tcpip', String(LEGACY_PORT)], 15000)
  // adbd 切换到 TCP/IP 时会重启，立即 connect 可能被拒绝；只重试连接，不重复切换。
  let failure: unknown
  for (let attempt = 0; attempt < 8; attempt++) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 1000))
    try {
      await connectWireless(endpoint)
      return { serial: endpoint, sdk }
    } catch (error) { failure = error }
  }
  throw new Error(`USB 已切换为无线调试，但连接 ${endpoint} 失败：${failure instanceof Error ? failure.message : String(failure)}`)
}
