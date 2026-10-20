/**
 * 桌面主进程入口：创建窗口并注册设备、任务与结果目录相关的 IPC。
 */
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { listDevices } from './adb'
import { DeviceRegistry } from './device-registry'
import { BatchCoordinator } from './batch-coordinator'
import { MirrorRegistry } from './mirror-registry'
import { connectWireless, enableLegacyWireless, pairWireless, validateLegacyIp } from './wireless-adb'
import { validateSelector, validateTask } from '../shared/task'
import { controlScroll, controlTouchEvents } from '../shared/touch'
import { AKEYCODE_HOME, encodeBackClick, encodeKeyClick, encodeScrollEvent, encodeTouchEvent } from '../shared/utils/scrcpy-control-msg'
import type { AutomationTask, ScrollInput, Selector, TouchInput } from '../shared/types'

let window: BrowserWindow | null = null
const devices = new DeviceRegistry()
const mirrors = new MirrorRegistry()
const batches = new BatchCoordinator(devices, (item) => {
  // 任务回调可能晚于窗口关闭，webContents getter 此时也会抛错
  if (!window || window.isDestroyed()) return
  const contents = window.webContents
  if (!contents.isDestroyed()) contents.send('run:event', item)
})

function createWindow(): void {
  window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'DroidStage',
    // 开发模式运行的是 Electron 自带的可执行文件，需单独指定窗口图标。
    icon: process.platform === 'win32' && !app.isPackaged
      ? path.join(app.getAppPath(), 'src/renderer/src/assets/droidstage-icon.ico')
      : undefined,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  if (process.env.ELECTRON_RENDERER_URL) window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else window.loadFile(path.join(__dirname, '../renderer/index.html'))
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url === 'https://developer.android.com/studio/run/oem-usb') shell.openExternal(url)
    return { action: 'deny' }
  })
}

app.whenReady().then(() => {
  createWindow()
  ipcMain.handle('devices:list', () => listDevices())
  ipcMain.handle('devices:pair-wireless', (_event, address: string, code: string) => pairWireless(address, code))
  ipcMain.handle('devices:connect-wireless', (_event, address: string) => connectWireless(address))
  ipcMain.handle('devices:legacy-wireless', async (_event, serial: string, ip: string) => {
    if (batches.isRunning(serial)) throw new Error('该设备正在运行任务，不能切换无线连接')
    validateLegacyIp(ip)
    const usb = (await listDevices()).find((device) => device.serial === serial && device.usb && device.state === 'device')
    if (!usb) throw new Error('请先通过 USB 连接手机并允许调试授权')
    await mirrors.stop(serial)
    await devices.disconnect(serial)
    return enableLegacyWireless(serial, ip)
  })
  ipcMain.handle('device:connect', async (_event, serial: string) => {
    if (batches.isRunning(serial)) throw new Error('该设备正在运行任务，不能重新连接')
    await devices.connect(serial)
  })
  ipcMain.handle('device:disconnect', async (_event, serial: string) => {
    if (batches.isRunning(serial)) throw new Error('请先取消该设备正在运行的任务')
    await mirrors.stop(serial)
    await devices.disconnect(serial)
  })
  // 渲染进程重载后界面状态归零，但会话仍活在主进程；提供查询以便恢复 UI 与投屏
  ipcMain.handle('device:states', () => devices.states())
  // 任务步骤与快照共用同一条代理连接，任务运行中刷新/校验会排队到长步骤之后等成超时，直接拒绝
  ipcMain.handle('device:snapshot', (_event, serial: string) => {
    if (batches.isRunning(serial)) throw new Error('任务运行中不能刷新层级')
    return devices.require(serial).snapshot()
  })
  ipcMain.handle('device:count', (_event, serial: string, selector: Selector) => {
    if (batches.isRunning(serial)) throw new Error('任务运行中不能校验控件')
    validateSelector(selector)
    return devices.require(serial).count(selector)
  })
  ipcMain.handle('mirror:start', async (_event, serial: string, quality: 'editor' | 'wall') => {
    if (!window) throw new Error('窗口未就绪')
    devices.require(serial)
    if (quality !== 'editor' && quality !== 'wall') throw new Error('未知投屏模式')
    await mirrors.start(window, serial, quality)
  })
  ipcMain.handle('mirror:stop', (_event, serial: string) => mirrors.stop(serial))
  // 手动操控三类输入统一编码为 scrcpy 控制消息直写控制通道（即发即弃），任务运行中禁止干预
  ipcMain.handle('mirror:touch', (_event, serial: string, input: TouchInput) => {
    if (batches.isRunning(serial)) throw new Error('任务运行中不能手动操控该设备')
    for (const touch of controlTouchEvents(input)) mirrors.sendControl(serial, encodeTouchEvent(touch))
  })
  ipcMain.handle('mirror:scroll', (_event, serial: string, input: ScrollInput) => {
    if (batches.isRunning(serial)) throw new Error('任务运行中不能手动操控该设备')
    mirrors.sendControl(serial, encodeScrollEvent(controlScroll(input)))
  })
  ipcMain.handle('device:key', (_event, serial: string, key: 'back' | 'home') => {
    if (key !== 'back' && key !== 'home') throw new Error('未知按键')
    if (batches.isRunning(serial)) throw new Error('任务运行中不能手动操控该设备')
    // back 走 BACK_OR_SCREEN_ON：息屏时 server 自动转为电源键，右键即具备唤醒能力
    for (const message of key === 'back' ? encodeBackClick() : encodeKeyClick(AKEYCODE_HOME)) mirrors.sendControl(serial, message)
  })
  ipcMain.handle('task:save', async (_event, task: AutomationTask) => {
    validateTask(task)
    const result = await dialog.showSaveDialog(window!, { title: '保存任务', defaultPath: `${task.name}.json`, filters: [{ name: 'DroidStage 任务', extensions: ['json'] }] })
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, JSON.stringify(task, null, 2), 'utf8')
    return result.filePath
  })
  ipcMain.handle('task:load', async () => {
    const result = await dialog.showOpenDialog(window!, { title: '打开任务', properties: ['openFile'], filters: [{ name: 'DroidStage 任务', extensions: ['json'] }] })
    if (result.canceled || !result.filePaths[0]) return null
    const text = await readFile(result.filePaths[0], 'utf8')
    if (text.length > 2_000_000) throw new Error('任务文件过大')
    const task: unknown = JSON.parse(text)
    validateTask(task)
    return task
  })
  ipcMain.handle('task:run', (_event, task: AutomationTask, serials: string[]) => batches.start(task, serials))
  ipcMain.handle('task:cancel', (_event, serial?: string) => batches.cancel(serial))
  ipcMain.handle('batch:state', () => batches.state())
  ipcMain.handle('batch:list', () => batches.history())
  ipcMain.handle('run:open-dir', async (_event, directory: string) => {
    if (typeof directory !== 'string') throw new Error('结果目录无效')
    const root = path.resolve(app.getPath('userData'), 'runs')
    const resolved = path.resolve(directory)
    const normalizedRoot = process.platform === 'win32' ? root.toLowerCase() : root
    const normalizedPath = process.platform === 'win32' ? resolved.toLowerCase() : resolved
    if (!normalizedPath.startsWith(normalizedRoot + path.sep)) throw new Error('只能打开任务结果目录')
    const error = await shell.openPath(resolved)
    if (error) throw new Error(error)
  })
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('before-quit', () => { void devices.closeAll(); void mirrors.stopAll() })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
