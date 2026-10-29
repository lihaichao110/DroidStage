/**
 * 设备列表与运行目标状态：连接会话保存在主进程，目标选择只保存在当前页面会话。
 */
import { useCallback, useState } from 'react'
import type { Device } from '../../../shared/types'
import { errorText } from '../../../shared/error-text'

export function useDeviceFleet(setMessage: (message: string) => void) {
  const [devices, setDevices] = useState<Device[]>([])
  const [connectedSerials, setConnectedSerials] = useState<string[]>([])
  const [targets, setTargets] = useState<string[]>([])
  const [focused, setFocused] = useState('')
  const [busySerial, setBusySerial] = useState('')
  const [wirelessBusy, setWirelessBusy] = useState(false)
  const [pendingLegacy, setPendingLegacy] = useState<{ usbSerial: string; endpoint: string; sdk: number } | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  /** 同时刷新 ADB 发现结果与主进程会话，移除已经离线的运行目标。 */
  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [list, states] = await Promise.all([window.androidAutoDesk.listDevices(), window.androidAutoDesk.sessionStates()])
      const known = new Set(list.map((device) => device.serial))
      const merged = [...list, ...states.filter((state) => !known.has(state.serial)).map((state): Device => ({ serial: state.serial, state: 'offline', usb: !state.serial.includes(':') }))]
      const online = states.filter((state) => state.connected && list.some((device) => device.serial === state.serial &&
        (device.state === 'device' || device.transport === 'companion'))).map((state) => state.serial)
      setDevices(merged)
      setConnectedSerials(online)
      setTargets((previous) => previous.filter((serial) => online.includes(serial)))
      setFocused((current) => online.includes(current) ? current : online[0] ?? '')
    } catch (error) { setMessage(errorText(error)) }
  }, [setMessage])

  /** 连接一台设备；首台设备同时成为默认编辑和运行目标。 */
  async function connect(serial: string): Promise<void> {
    setBusySerial(serial)
    try {
      await window.androidAutoDesk.connect(serial)
      setErrors((current) => { const next = { ...current }; delete next[serial]; return next })
      if (!focused) setFocused(serial)
      if (!connectedSerials.length) setTargets([serial])
      await refresh()
      setMessage(`已连接设备 ${serial}`)
    } catch (error) { setErrors((current) => ({ ...current, [serial]: errorText(error) })); setMessage(errorText(error)) }
    finally { setBusySerial('') }
  }

  async function disconnect(serial: string): Promise<void> {
    setBusySerial(serial)
    try { await window.androidAutoDesk.disconnect(serial); await refresh(); setMessage(`已断开设备 ${serial}`) }
    catch (error) { setErrors((current) => ({ ...current, [serial]: errorText(error) })); setMessage(errorText(error)) }
    finally { setBusySerial('') }
  }

  /** 安装后打开手机端界面，权限与服务启动由用户在手机上完成。 */
  async function installCompanion(serial: string): Promise<void> {
    setBusySerial(serial)
    try {
      await window.androidAutoDesk.installCompanion(serial)
      setMessage('已安装手机端应用。请在手机上开启无障碍、启动无线服务并允许录屏。')
    } catch (error) { setMessage(errorText(error)) }
    finally { setBusySerial('') }
  }

  async function pairCompanion(serial: string, ip: string): Promise<void> {
    setBusySerial(serial)
    try {
      const paired = await window.androidAutoDesk.pairCompanion(serial, ip)
      await refresh()
      setMessage(`已通过 USB 配对 ${paired.model}。拔线后点击列表中的“连接”。`)
    } catch (error) { setMessage(errorText(error)) }
    finally { setBusySerial('') }
  }

  async function updateCompanionIp(serial: string, ip: string): Promise<void> {
    setBusySerial(serial)
    try {
      await window.androidAutoDesk.updateCompanionIp(serial, ip)
      await refresh()
      setMessage('已更新手机局域网地址；重新连接时仍会校验首次配对的证书。')
    } catch (error) { setMessage(errorText(error)) }
    finally { setBusySerial('') }
  }

  async function pairWireless(address: string, code: string): Promise<boolean> {
    setWirelessBusy(true)
    try { await window.androidAutoDesk.pairWireless(address, code); setMessage('无线配对成功，请输入手机显示的连接地址和端口。'); return true }
    catch (error) { setMessage(errorText(error)); return false }
    finally { setWirelessBusy(false) }
  }

  async function connectWireless(address: string): Promise<void> {
    setWirelessBusy(true)
    try {
      await window.androidAutoDesk.connectWireless(address)
      await window.androidAutoDesk.connect(address.trim())
      if (!focused) setFocused(address.trim())
      if (!connectedSerials.length) setTargets([address.trim()])
      await refresh()
      setMessage(`已连接无线设备 ${address.trim()}`)
    } catch (error) { setErrors((current) => ({ ...current, [address.trim()]: errorText(error) })); setMessage(errorText(error)); await refresh() }
    finally { setWirelessBusy(false) }
  }

  /** USB 授权后仅启用旧版 TCP/IP 调试；拔线后的连接由单独的验证步骤完成。 */
  async function enableLegacyWireless(serial: string, ip: string): Promise<void> {
    setBusySerial(serial)
    setWirelessBusy(true)
    setPendingLegacy(null)
    try {
      // 开发中的页面可能热更新，但已打开窗口的预加载脚本仍是旧版本。
      const enableWireless = window.androidAutoDesk?.enableLegacyWireless
      if (typeof enableWireless !== 'function') throw new Error('应用版本未更新，请完全退出并重新启动')
      const { serial: endpoint, sdk } = await enableWireless(serial, ip)
      setPendingLegacy({ usbSerial: serial, endpoint, sdk })
      setErrors((current) => { const next = { ...current }; delete next[serial]; delete next[endpoint]; return next })
      await refresh()
      setMessage(`已启用手机的无线 ADB 端口 ${endpoint}。请拔掉 USB 数据线，再点击“拔线后验证连接”。`)
    } catch (error) {
      setErrors((current) => ({ ...current, [serial]: errorText(error) }))
      setMessage(errorText(error))
      await refresh()
    } finally { setBusySerial(''); setWirelessBusy(false) }
  }

  /** 拔线后确认 ADB 无线端点在线，再为受支持设备建立任务会话。 */
  async function verifyLegacyWireless(): Promise<void> {
    if (!pendingLegacy) return
    const { usbSerial, endpoint, sdk } = pendingLegacy
    setWirelessBusy(true)
    try {
      const verify = window.androidAutoDesk?.verifyLegacyWireless
      if (typeof verify !== 'function') throw new Error('应用版本未更新，请完全退出并重新启动')
      await verify(usbSerial, endpoint)
      if (sdk >= 29) await window.androidAutoDesk.connect(endpoint)
      setErrors((current) => { const next = { ...current }; delete next[endpoint]; return next })
      if (sdk >= 29) {
        setFocused(endpoint)
        setTargets((current) => {
          const next = current.map((serial) => serial === usbSerial ? endpoint : serial)
          return next.length ? next : [endpoint]
        })
      }
      setPendingLegacy(null)
      await refresh()
      setMessage(sdk >= 29 ? `已在拔线后连接无线设备 ${endpoint}（API ${sdk}）` : `无线 ADB 已连接 ${endpoint}（API ${sdk}）；当前辅助 APK 要求 Android 10/API 29，暂不能运行任务`)
    } catch (error) {
      setErrors((current) => ({ ...current, [endpoint]: errorText(error) }))
      setMessage(errorText(error))
      await refresh()
    } finally { setWirelessBusy(false) }
  }

  /** 对已离线的无线设备重新执行 adb connect；serial 本身就是 ip:port 端点，无需再插 USB。 */
  async function reconnectWireless(serial: string): Promise<void> {
    setWirelessBusy(true)
    try {
      await window.androidAutoDesk.connectWireless(serial)
      setErrors((current) => { const next = { ...current }; delete next[serial]; return next })
      // Android 9 及以下按设计不支持任务会话，ADB 层恢复即达成本按钮目的；会话失败不算重连失败。
      let sessionReady = true
      try { await window.androidAutoDesk.connect(serial) } catch { sessionReady = false }
      if (sessionReady) {
        if (!focused) setFocused(serial)
        if (!connectedSerials.length) setTargets([serial])
      }
      await refresh()
      setMessage(sessionReady ? `已重新连接无线设备 ${serial}` : `无线 ADB 已重新连接 ${serial}；会话未建立，可在列表中手动连接`)
    } catch (error) {
      setErrors((current) => ({ ...current, [serial]: errorText(error) }))
      setMessage(`重连失败：${errorText(error)}`)
    } finally { setWirelessBusy(false) }
  }

  function toggleTarget(serial: string): void {
    if (!connectedSerials.includes(serial)) return
    setTargets((current) => current.includes(serial) ? current.filter((item) => item !== serial) : [...current, serial])
  }

  function selectTargets(serials: string[]): void { setTargets(serials.filter((serial) => connectedSerials.includes(serial))) }

  return { devices, connectedSerials, targets, focused, busySerial, pendingLegacy, wirelessBusy, errors, refresh, connect, disconnect, installCompanion, pairCompanion, updateCompanionIp, pairWireless, connectWireless, enableLegacyWireless, verifyLegacyWireless, reconnectWireless, toggleTarget, selectTargets, setFocused }
}
