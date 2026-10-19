import { contextBridge, ipcRenderer } from 'electron'
import type { AppApi, AutomationTask, MirrorStatus, RunEvent, Selector, TouchInput } from '../shared/types'

const api: AppApi = {
  listDevices: () => ipcRenderer.invoke('devices:list'),
  connect: (serial: string) => ipcRenderer.invoke('device:connect', serial),
  disconnect: () => ipcRenderer.invoke('device:disconnect'),
  sessionState: () => ipcRenderer.invoke('device:state'),
  snapshot: () => ipcRenderer.invoke('device:snapshot'),
  count: (selector: Selector) => ipcRenderer.invoke('device:count', selector),
  saveTask: (task: AutomationTask) => ipcRenderer.invoke('task:save', task),
  loadTask: () => ipcRenderer.invoke('task:load'),
  runTask: (task: AutomationTask) => ipcRenderer.invoke('task:run', task),
  cancelRun: () => ipcRenderer.invoke('task:cancel'),
  openRunDir: (directory: string) => ipcRenderer.invoke('run:open-dir', directory),
  onRunEvent: (listener: (event: RunEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, item: RunEvent): void => listener(item)
    ipcRenderer.on('run:event', handler)
    return () => ipcRenderer.removeListener('run:event', handler)
  },
  startMirroring: () => ipcRenderer.invoke('mirror:start'),
  stopMirroring: () => ipcRenderer.invoke('mirror:stop'),
  sendTouch: (event: TouchInput) => ipcRenderer.invoke('mirror:touch', event),
  sendScroll: (input: { x: number; y: number; dy: number }) => ipcRenderer.invoke('mirror:scroll', input),
  sendKey: (key: 'back' | 'home') => ipcRenderer.invoke('device:key', key),
  // 视频流走常规 IPC：实测 sandbox 渲染进程收得到 MessagePort 对象但收不到端口消息
  onMirrorStream: (listener: (meta: { physicalWidth: number; physicalHeight: number }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, meta: { physicalWidth: number; physicalHeight: number }): void => {
      listener(meta)
    }
    ipcRenderer.on('mirror:stream', handler)
    return () => ipcRenderer.removeListener('mirror:stream', handler)
  },
  onMirrorChunk: (listener: (bytes: Uint8Array) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, bytes: Uint8Array): void => {
      listener(bytes)
    }
    ipcRenderer.on('mirror:chunk', handler)
    return () => ipcRenderer.removeListener('mirror:chunk', handler)
  },
  onMirrorStatus: (listener: (status: MirrorStatus) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, item: MirrorStatus): void => listener(item)
    ipcRenderer.on('mirror:status', handler)
    return () => ipcRenderer.removeListener('mirror:status', handler)
  }
}

contextBridge.exposeInMainWorld('androidAutoDesk', api)
