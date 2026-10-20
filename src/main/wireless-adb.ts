/**
 * 无线 ADB：校验手机显示的端点，并执行配对与连接。
 */
import { adb, listDevices } from './adb'

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
