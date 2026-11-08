import { useSyncExternalStore } from 'react'
import { isNative } from './native'
import { androidUpdater } from './androidUpdate'
import { setBusy } from './busy'

// One update state for the whole app, on every platform. The check runs by itself a few
// seconds after start and every few hours; when a new version exists its download starts at
// once, so the user only has to confirm the install. Backends (same shape everywhere):
//   desktop -> window.updater (Windows installer, macOS .dmg swap, portable: link only)
//   android -> androidUpdater (APK download + system installer)
const backend = isNative ? androidUpdater : window.updater || null

export const updatesSupported = Boolean(backend)

let state = { status: 'idle', info: null, percent: 0, message: '', dismissed: false, manual: false }
const listeners = new Set()

function set(patch) {
  state = { ...state, ...patch }
  setBusy('update', state.status === 'downloading')
  listeners.forEach((cb) => cb())
}

let wired = false
function wire() {
  if (wired || !backend) return
  wired = true
  backend.onProgress((percent) => state.status === 'downloading' && set({ percent }))
  backend.onDownloaded(() => set({ status: 'ready', percent: 100 }))
  backend.onFailed(() => state.status === 'downloading' && set({ status: 'error', message: 'Falha ao baixar a atualização.' }))
}

export function useUpdate() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => state
  )
}

export async function checkForUpdates({ manual = false } = {}) {
  if (!backend) return
  wire()
  if (state.status === 'checking') return
  if (state.status === 'downloading' || state.status === 'ready') {
    set({ dismissed: false, message: '' })
    return
  }
  set({ status: 'checking', manual, message: '' })
  const result = await backend.check()
  if (!result.ok) return set({ status: 'error', message: result.error })
  if (!result.hasUpdate) return set({ status: 'latest', info: result })
  set({ status: 'available', info: result, dismissed: false })
  // Windows installer, macOS and Android can fetch the update themselves: do it right away.
  if (result.mode === 'auto' || result.mode === 'mac' || result.mode === 'apk') downloadUpdate()
}

export async function downloadUpdate() {
  set({ status: 'downloading', percent: 0, message: '' })
  const ok = await backend.download(state.info?.downloadUrl)
  if (!ok) set({ status: 'error', message: 'Falha ao baixar a atualização.' })
}

export async function installUpdate() {
  const result = await backend.install()
  if (result && result.ok === false && result.message) set({ message: result.message })
}

export const openDownload = () => backend.open(state.info?.downloadUrl)
export const dismissUpdate = () => set({ dismissed: true })
// Brings the banner back after "Depois" (the version label on the profile screen uses it).
export const showUpdate = () => set({ dismissed: false })

const FIRST_CHECK_MS = 5000
const RECHECK_MS = 6 * 60 * 60 * 1000
let started = false

export function startAutoCheck() {
  if (!backend || started) return
  started = true
  setTimeout(() => checkForUpdates(), FIRST_CHECK_MS)
  setInterval(() => checkForUpdates(), RECHECK_MS)
}
