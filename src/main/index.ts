import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { listDevices } from './adb'
import { DeviceSession } from './session'
import { TaskRunner } from './runner'
import { MirrorService } from './mirroring'
import { validateSelector, validateTask } from '../shared/task'
import { touchArgs } from '../shared/touch'
import type { AutomationTask, Selector, RunEvent, TouchInput } from '../shared/types'

let window: BrowserWindow | null = null
let session: DeviceSession | null = null
const runner = new TaskRunner()
const mirror = new MirrorService()

function createWindow(): void {
  window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'AndroidAutoDesk',
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

function requireSession(): DeviceSession {
  if (!session) throw new Error('请先连接手机')
  return session
}

app.whenReady().then(() => {
  createWindow()
  ipcMain.handle('devices:list', () => listDevices())
  ipcMain.handle('device:connect', async (_event, serial: string) => {
    if (runner.isRunning()) throw new Error('任务运行中不能切换设备')
    await mirror.stop()
    await session?.close()
    session = null
    session = await DeviceSession.open(serial)
  })
  ipcMain.handle('device:disconnect', async () => {
    if (runner.isRunning()) throw new Error('请先取消正在运行的任务')
    await mirror.stop()
    await session?.close()
    session = null
  })
  // 渲染进程重载后界面状态归零，但会话仍活在主进程；提供查询以便恢复 UI 与投屏
  ipcMain.handle('device:state', () => ({ connected: session !== null, serial: session?.serial ?? null }))
  ipcMain.handle('device:snapshot', () => requireSession().snapshot())
  ipcMain.handle('device:count', (_event, selector: Selector) => {
    validateSelector(selector)
    return requireSession().count(selector)
  })
  ipcMain.handle('mirror:start', async () => {
    if (!window) throw new Error('窗口未就绪')
    await mirror.start(window, requireSession().serial)
  })
  ipcMain.handle('mirror:stop', () => mirror.stop())
  // 手动操控三类输入统一走触摸通道（与命令通道隔离），任务运行中禁止干预
  ipcMain.handle('mirror:touch', (_event, input: TouchInput) => {
    if (runner.isRunning()) throw new Error('任务运行中不能手动操控')
    return requireSession().touchClientOrConnect().then((client) => client.request('touch', touchArgs(input), 5000))
  })
  ipcMain.handle('mirror:scroll', (_event, input: { x: number; y: number; dy: number }) => {
    if (runner.isRunning()) throw new Error('任务运行中不能手动操控')
    const isFiniteCoord = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
    if (!isFiniteCoord(input?.x) || !isFiniteCoord(input?.y) || !isFiniteCoord(input?.dy) || Math.abs(input.dy) > 1000) throw new Error('滚轮参数无效')
    const args = { x: Math.round(input.x), y: Math.round(input.y), dy: Math.round(input.dy) }
    return requireSession().touchClientOrConnect().then((client) => client.request('scroll', args, 5000))
  })
  ipcMain.handle('device:key', (_event, key: 'back' | 'home') => {
    if (key !== 'back' && key !== 'home') throw new Error('未知按键')
    if (runner.isRunning()) throw new Error('任务运行中不能手动操控')
    return requireSession().touchClientOrConnect().then((client) => client.request('key', { key }, 5000))
  })
  ipcMain.handle('task:save', async (_event, task: AutomationTask) => {
    validateTask(task)
    const result = await dialog.showSaveDialog(window!, { title: '保存任务', defaultPath: `${task.name}.json`, filters: [{ name: 'AndroidAutoDesk 任务', extensions: ['json'] }] })
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, JSON.stringify(task, null, 2), 'utf8')
    return result.filePath
  })
  ipcMain.handle('task:load', async () => {
    const result = await dialog.showOpenDialog(window!, { title: '打开任务', properties: ['openFile'], filters: [{ name: 'AndroidAutoDesk 任务', extensions: ['json'] }] })
    if (result.canceled || !result.filePaths[0]) return null
    const text = await readFile(result.filePaths[0], 'utf8')
    if (text.length > 2_000_000) throw new Error('任务文件过大')
    const task: unknown = JSON.parse(text)
    validateTask(task)
    return task
  })
  ipcMain.handle('task:run', async (_event, task: AutomationTask) => {
    const emit = (item: RunEvent): void => { window?.webContents.send('run:event', item) }
    await runner.run(task, requireSession(), emit)
  })
  ipcMain.handle('task:cancel', () => runner.cancel())
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

app.on('before-quit', () => { void session?.close(); void mirror.stop() })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
