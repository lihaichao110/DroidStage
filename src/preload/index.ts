import { contextBridge, ipcRenderer } from 'electron'
import type { AppApi, AutomationTask, MirrorStatus, RunEvent, ScrollInput, Selector, TouchInput } from '../shared/types'

const api: AppApi = {
  listDevices: () => ipcRenderer.invoke('devices:list'),
  pairWireless: (address: string, code: string) => ipcRenderer.invoke('devices:pair-wireless', address, code),
  connectWireless: (address: string) => ipcRenderer.invoke('devices:connect-wireless', address),
  connect: (serial: string) => ipcRenderer.invoke('device:connect', serial),
  disconnect: (serial: string) => ipcRenderer.invoke('device:disconnect', serial),
  sessionStates: () => ipcRenderer.invoke('device:states'),
  snapshot: (serial: string) => ipcRenderer.invoke('device:snapshot', serial),
  count: (serial: string, selector: Selector) => ipcRenderer.invoke('device:count', serial, selector),
  saveTask: (task: AutomationTask) => ipcRenderer.invoke('task:save', task),
  loadTask: () => ipcRenderer.invoke('task:load'),
  runTask: (task: AutomationTask, serials: string[]) => ipcRenderer.invoke('task:run', task, serials),
  cancelRun: (serial?: string) => ipcRenderer.invoke('task:cancel', serial),
  batchState: () => ipcRenderer.invoke('batch:state'),
  listBatches: () => ipcRenderer.invoke('batch:list'),
  openRunDir: (directory: string) => ipcRenderer.invoke('run:open-dir', directory),
  onRunEvent: (listener: (event: RunEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, item: RunEvent): void => listener(item)
    ipcRenderer.on('run:event', handler)
    return () => ipcRenderer.removeListener('run:event', handler)
  },
  startMirroring: (serial: string, quality: 'editor' | 'wall') => ipcRenderer.invoke('mirror:start', serial, quality),
  stopMirroring: (serial: string) => ipcRenderer.invoke('mirror:stop', serial),
  sendTouch: (serial: string, event: TouchInput) => ipcRenderer.invoke('mirror:touch', serial, event),
  sendScroll: (serial: string, input: ScrollInput) => ipcRenderer.invoke('mirror:scroll', serial, input),
  sendKey: (serial: string, key: 'back' | 'home') => ipcRenderer.invoke('device:key', serial, key),
  // 视频流走常规 IPC：实测 sandbox 渲染进程收得到 MessagePort 对象但收不到端口消息
  onMirrorStream: (listener: (item: { serial: string; physicalWidth: number; physicalHeight: number }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, item: { serial: string; physicalWidth: number; physicalHeight: number }): void => {
      listener(item)
    }
    ipcRenderer.on('mirror:stream', handler)
    return () => ipcRenderer.removeListener('mirror:stream', handler)
  },
  onMirrorChunk: (listener: (item: { serial: string; bytes: Uint8Array }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, item: { serial: string; bytes: Uint8Array }): void => {
      listener(item)
    }
    ipcRenderer.on('mirror:chunk', handler)
    return () => ipcRenderer.removeListener('mirror:chunk', handler)
  },
  onMirrorStatus: (listener: (item: { serial: string; status: MirrorStatus }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, item: { serial: string; status: MirrorStatus }): void => listener(item)
    ipcRenderer.on('mirror:status', handler)
    return () => ipcRenderer.removeListener('mirror:status', handler)
  }
}

contextBridge.exposeInMainWorld('androidAutoDesk', api)
