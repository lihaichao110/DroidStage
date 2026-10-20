/**
 * 设备列表与运行目标状态：连接会话保存在主进程，目标选择只保存在当前页面会话。
 */
import { useCallback, useState } from 'react'
import type { Device } from '../../../shared/types'

export function useDeviceFleet(setMessage: (message: string) => void) {
  const [devices, setDevices] = useState<Device[]>([])
  const [connectedSerials, setConnectedSerials] = useState<string[]>([])
  const [targets, setTargets] = useState<string[]>([])
  const [focused, setFocused] = useState('')
  const [busySerial, setBusySerial] = useState('')
  const [wirelessBusy, setWirelessBusy] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  /** 同时刷新 ADB 发现结果与主进程会话，移除已经离线的运行目标。 */
  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [list, states] = await Promise.all([window.androidAutoDesk.listDevices(), window.androidAutoDesk.sessionStates()])
      const known = new Set(list.map((device) => device.serial))
      const merged = [...list, ...states.filter((state) => !known.has(state.serial)).map((state): Device => ({ serial: state.serial, state: 'offline', usb: !state.serial.includes(':') }))]
      const online = states.filter((state) => state.connected && list.some((device) => device.serial === state.serial && device.state === 'device')).map((state) => state.serial)
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

  function toggleTarget(serial: string): void {
    if (!connectedSerials.includes(serial)) return
    setTargets((current) => current.includes(serial) ? current.filter((item) => item !== serial) : [...current, serial])
  }

  function selectTargets(serials: string[]): void { setTargets(serials.filter((serial) => connectedSerials.includes(serial))) }

  return { devices, connectedSerials, targets, focused, busySerial, wirelessBusy, errors, refresh, connect, disconnect, pairWireless, connectWireless, toggleTarget, selectTargets, setFocused }
}

function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error) }
