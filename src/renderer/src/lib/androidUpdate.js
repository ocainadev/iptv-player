import { registerPlugin } from '@capacitor/core'
import { App } from '@capacitor/app'

const ExternalLink = registerPlugin('ExternalLink')
const ApkUpdate = registerPlugin('ApkUpdate')

// Keep in sync with GITHUB_REPO in src/main/updater.js and ALLOWED in ApkUpdatePlugin.java.
// VITE_UPDATE_API only exists to test the flow against a local mock of the GitHub response.
const API_URL = import.meta.env.VITE_UPDATE_API || 'https://api.github.com/repos/ocainadev/telara/releases/latest'

const parse = (v) => String(v).replace(/^v/i, '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0)

function isNewer(latest, current) {
  const a = parse(latest)
  const b = parse(current)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] || 0) - (b[i] || 0)
    if (diff) return diff > 0
  }
  return false
}

const progressListeners = new Set()
const downloadedListeners = new Set()
const failedListeners = new Set()
const subscribe = (set) => (cb) => {
  set.add(cb)
  return () => set.delete(cb)
}

// Same shape as window.updater on desktop. The APK is downloaded by the app and handed to the
// system installer, which always asks the user to confirm: an app cannot update itself silently.
export const androidUpdater = {
  async check() {
    const { version: current } = await App.getInfo()
    try {
      const res = await fetch(API_URL, { headers: { Accept: 'application/vnd.github+json' } })
      if (res.status === 404) return { ok: true, current, latest: current, hasUpdate: false }
      if (!res.ok) return { ok: false, current, error: `GitHub respondeu ${res.status}.` }
      const release = await res.json()
      const latest = String(release.tag_name).replace(/^v/i, '')
      const apk = (release.assets || []).find((a) => a.name.toLowerCase().endsWith('.apk'))
      if (!isNewer(latest, current) || !apk) return { ok: true, current, latest, hasUpdate: false }
      return { ok: true, current, latest, hasUpdate: true, mode: 'apk', downloadUrl: apk.browser_download_url }
    } catch {
      return { ok: false, current, error: 'Não foi possível consultar o GitHub.' }
    }
  },
  async download(url) {
    let last = -1
    const handle = await ApkUpdate.addListener('progress', ({ percent }) => {
      if (percent === last) return
      last = percent
      progressListeners.forEach((cb) => cb(percent))
    })
    try {
      await ApkUpdate.download({ url })
      downloadedListeners.forEach((cb) => cb())
      return true
    } catch {
      failedListeners.forEach((cb) => cb())
      return false
    } finally {
      handle.remove()
    }
  },
  async install() {
    try {
      await ApkUpdate.install()
      return { ok: true }
    } catch (e) {
      if (e?.code === 'permission') {
        return { ok: false, message: 'Permita "instalar apps desconhecidos" para o Telara nas configurações e toque em Instalar de novo.' }
      }
      return { ok: false, message: 'Não foi possível abrir o instalador.' }
    }
  },
  open: (url) => ExternalLink.open({ url }),
  onProgress: subscribe(progressListeners),
  onDownloaded: subscribe(downloadedListeners),
  onFailed: subscribe(failedListeners)
}
