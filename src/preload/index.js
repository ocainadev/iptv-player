import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('platform', { os: process.platform })

// Subscribes to a main-process event and returns the unsubscribe function.
function on(channel, cb) {
  const handler = (_e, payload) => cb(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

contextBridge.exposeInMainWorld('updater', {
  check: () => ipcRenderer.invoke('updater:check'),
  download: () => ipcRenderer.invoke('updater:download'),
  install: () => ipcRenderer.invoke('updater:install'),
  open: (url) => ipcRenderer.invoke('updater:open', url),
  onProgress: (cb) => on('updater:progress', cb),
  onDownloaded: (cb) => on('updater:downloaded', cb),
  onFailed: (cb) => on('updater:failed', cb)
})
