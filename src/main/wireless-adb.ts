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
  let output: string
  try {
    output = (await adb(['connect', endpoint], 15000)).toString('utf8')
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw wirelessConnectionError(endpoint, reason)
  }
  if (!/connected to/i.test(output)) throw wirelessConnectionError(endpoint, output.trim() || '无线设备连接失败')
  const device = (await listDevices()).find((item) => item.serial === endpoint)
  if (!device || device.state !== 'device') throw new Error(`无线设备 ${endpoint} 未就绪，请检查无线调试与网络`)
}

/** 将端口拒绝错误转换为可操作提示，其余 ADB 错误保持原始原因。 */
function wirelessConnectionError(endpoint: string, reason: string): Error {
  // 连接被拒绝表示目标端口未接受连接；继续重试 adb connect 无法开启手机端监听。
  if (endpoint.endsWith(`:${LEGACY_PORT}`) && /10061|ECONNREFUSED|connection refused|actively refused|积极拒绝|连接被拒绝/i.test(reason)) {
    return new Error(`手机 ${endpoint} 的 5555 端口未开放或拒绝连接。请重新插入 USB，点击“1. 启用无线调试”，拔线后再验证；若手机每次拔线都关闭端口，请使用 USB 连接。原始错误：${reason}`)
  }
  return new Error(reason)
}

/**
 * 用已授权的 USB 设备启用旧版 ADB TCP/IP；实际无线连接须在拔线后验证。
 * @param serial 当前 USB 序列号
 * @param ip 手机在局域网中的 IP 地址
 * @returns 无线序列号及设备实际 Android API 等级
 * @throws USB 未授权、IP 无效或 ADB 模式切换失败时抛出
 */
export async function enableLegacyWireless(serial: string, ip: string): Promise<{ serial: string; sdk: number }> {
  const address = validateLegacyIp(ip)
  const usbDevice = (await listDevices()).find((device) => device.serial === serial && device.usb)
  if (!usbDevice || usbDevice.state !== 'device') throw new Error('请先通过 USB 连接手机并允许调试授权')
  const sdk = Number((await adb(['-s', serial, 'shell', 'getprop', 'ro.build.version.sdk'])).toString('utf8').trim())
  if (!Number.isInteger(sdk) || sdk < 1) throw new Error('无法读取手机的 Android API 等级')
  const endpoint = `${address}:${LEGACY_PORT}`
  await adb(['-s', serial, 'tcpip', String(LEGACY_PORT)], 15000)
  return { serial: endpoint, sdk }
}

/**
 * 拔线后确认 USB 传输已消失，再验证旧版无线 ADB 端点。
 * @param usbSerial 启用 TCP/IP 时使用的 USB 序列号
 * @param address 预期的 IP:5555 端点
 * @throws USB 仍在线、端点无效或无线连接失败时抛出
 */
export async function verifyLegacyWireless(usbSerial: string, address: string): Promise<void> {
  const endpoint = validateEndpoint(address)
  if (!endpoint.endsWith(`:${LEGACY_PORT}`)) throw new Error('旧版无线调试端口必须是 5555')
  if ((await listDevices()).some((device) => device.serial === usbSerial && device.usb)) {
    throw new Error('请先拔掉 USB 数据线，再验证无线连接')
  }
  await connectWireless(endpoint)
}
