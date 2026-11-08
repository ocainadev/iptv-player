import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('platform', { os: process.platform })
contextBridge.exposeInMainWorld('appInfo', {
  version: () => ipcRenderer.invoke('app:version'),
  setBusy: (busy) => ipcRenderer.send('app:busy', Boolean(busy))
})

// Subscribes to a main-process event and returns the unsubscribe function.
function on(channel, cb) {
  const handler = (_e, payload) => cb(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

contextBridge.exposeInMainWorld('updater', {
  check: () => ipcRenderer.invoke('updater:check'),
  download: (url) => ipcRenderer.invoke('updater:download', url),
  install: () => ipcRenderer.invoke('updater:install'),
  open: (url) => ipcRenderer.invoke('updater:open', url),
  onProgress: (cb) => on('updater:progress', cb),
  onDownloaded: (cb) => on('updater:downloaded', cb),
  onFailed: (cb) => on('updater:failed', cb)
})
