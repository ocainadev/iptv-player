import { registerPlugin } from '@capacitor/core'
import { App } from '@capacitor/app'

const ExternalLink = registerPlugin('ExternalLink')

// Keep in sync with GITHUB_REPO in src/main/updater.js and ALLOWED_PREFIX in ExternalLinkPlugin.java.
// VITE_UPDATE_API only exists to test the flow against a local mock of the GitHub response.
const API_URL = import.meta.env.VITE_UPDATE_API || 'https://api.github.com/repos/ocainadev/iptv-player/releases/latest'

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

// Same shape as window.updater on desktop, manual mode only: the APK is downloaded
// by the browser and installed by Android, since an app cannot replace itself silently.
export const androidUpdater = {
  async check() {
    const { version: current } = await App.getInfo()
    try {
      const res = await fetch(API_URL, { headers: { Accept: 'application/vnd.github+json' } })
      if (res.status === 404) return { ok: false, current, error: 'Nenhuma versão publicada ainda.' }
      if (!res.ok) return { ok: false, current, error: `GitHub respondeu ${res.status}.` }
      const release = await res.json()
      const latest = String(release.tag_name).replace(/^v/i, '')
      const apk = (release.assets || []).find((a) => a.name.toLowerCase().endsWith('.apk'))
      if (!isNewer(latest, current) || !apk) return { ok: true, current, latest, hasUpdate: false }
      return { ok: true, current, latest, hasUpdate: true, mode: 'manual', downloadUrl: apk.browser_download_url }
    } catch {
      return { ok: false, current, error: 'Não foi possível consultar o GitHub.' }
    }
  },
  open: (url) => ExternalLink.open({ url }),
  download: async () => false,
  install: () => {},
  onProgress: () => () => {},
  onDownloaded: () => () => {},
  onFailed: () => () => {}
}
