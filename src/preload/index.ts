/**
 * 预加载桥接：向渲染进程暴露受控的设备、任务和投屏 IPC 接口。
 */
import { contextBridge, ipcRenderer } from 'electron'
import type { AppApi, AutomationTask, ListClickStep, MirrorStatus, RunEvent, ScrollInput, Selector, TouchInput } from '../shared/types'

const api: AppApi = {
  listDevices: () => ipcRenderer.invoke('devices:list'),
  installCompanion: (serial: string) => ipcRenderer.invoke('devices:install-companion', serial),
  pairCompanion: (serial: string, ip: string) => ipcRenderer.invoke('devices:pair-companion', serial, ip),
  updateCompanionIp: (serial: string, ip: string) => ipcRenderer.invoke('devices:update-companion-ip', serial, ip),
  pairWireless: (address: string, code: string) => ipcRenderer.invoke('devices:pair-wireless', address, code),
  connectWireless: (address: string) => ipcRenderer.invoke('devices:connect-wireless', address),
  enableLegacyWireless: (serial: string, ip: string) => ipcRenderer.invoke('devices:legacy-wireless', serial, ip),
  verifyLegacyWireless: (serial: string, address: string) => ipcRenderer.invoke('devices:verify-legacy-wireless', serial, address),
  connect: (serial: string) => ipcRenderer.invoke('device:connect', serial),
  disconnect: (serial: string) => ipcRenderer.invoke('device:disconnect', serial),
  sessionStates: () => ipcRenderer.invoke('device:states'),
  snapshot: (serial: string) => ipcRenderer.invoke('device:snapshot', serial),
  count: (serial: string, selector: Selector) => ipcRenderer.invoke('device:count', serial, selector),
  inspectMatches: (serial: string, selector: Selector) => ipcRenderer.invoke('device:matches', serial, selector),
  previewList: (serial: string, step: ListClickStep) => ipcRenderer.invoke('device:list-preview', serial, step),
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
