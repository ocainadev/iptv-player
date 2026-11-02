import { app, BrowserWindow, ipcMain, shell } from 'electron'
import electronUpdater from 'electron-updater'

const { autoUpdater } = electronUpdater

// "owner/repo" of the GitHub repository that hosts the releases.
// Keep in sync with `publish` in electron-builder.yml.
const GITHUB_REPO = 'OWNER/REPO'

const [OWNER, REPO] = GITHUB_REPO.split('/')
const API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`
const ALLOWED_PREFIX = `https://github.com/${GITHUB_REPO}/`

// In-app install only works for the installed Windows build. The portable .exe
// has no install dir to replace, and macOS needs a paid signature for it, so
// those download the installer instead.
const AUTO_INSTALL = process.platform === 'win32' && app.isPackaged && !process.env.PORTABLE_EXECUTABLE_DIR

let installing = false
// The window asks for confirmation on close; that must not block the installer.
export const isInstalling = () => installing

// "v1.2.3" -> [1, 2, 3]; anything after a dash (pre-release) is ignored.
function parseVersion(v) {
  return String(v).replace(/^v/i, '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0)
}

function isNewer(latest, current) {
  const a = parseVersion(latest)
  const b = parseVersion(current)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] || 0) - (b[i] || 0)
    if (diff) return diff > 0
  }
  return false
}

// Picks the installer for this OS/arch. electron-builder names: "...-arm64.dmg",
// "...-<ver>.dmg" (Intel), "... Setup <ver>.exe".
function pickAsset(assets) {
  const names = assets.map((a) => ({ name: a.name.toLowerCase(), url: a.browser_download_url }))
  let found
  if (process.platform === 'darwin') {
    const dmgs = names.filter((a) => a.name.endsWith('.dmg'))
    found = process.arch === 'arm64' ? dmgs.find((a) => a.name.includes('arm64')) : dmgs.find((a) => !a.name.includes('arm64'))
  } else if (process.platform === 'win32') {
    found = names.find((a) => a.name.endsWith('.exe') && a.name.includes('setup'))
  }
  return found?.url ?? null
}

const notConfigured = (current) => ({
  ok: false,
  current,
  error: 'Repositório do GitHub não configurado (src/main/updater.js).'
})

// Manual flow: ask the GitHub API and hand back a download link.
async function checkManual() {
  const current = app.getVersion()
  if (GITHUB_REPO === 'OWNER/REPO') return notConfigured(current)
  try {
    const res = await fetch(API_URL, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'iptv-player-updater' },
      signal: AbortSignal.timeout(10000)
    })
    if (res.status === 404) return { ok: true, mode: 'manual', current, hasUpdate: false, latest: current }
    if (!res.ok) return { ok: false, current, error: `GitHub respondeu ${res.status}.` }
    const release = await res.json()
    const latest = String(release.tag_name || '').replace(/^v/i, '')
    const pageUrl = typeof release.html_url === 'string' ? release.html_url : null
    const assetUrl = pickAsset(Array.isArray(release.assets) ? release.assets : [])
    return {
      ok: true,
      mode: 'manual',
      current,
      latest,
      hasUpdate: isNewer(latest, current),
      downloadUrl: assetUrl || pageUrl
    }
  } catch {
    return { ok: false, current, error: 'Não foi possível conectar ao GitHub.' }
  }
}

// Auto flow: electron-updater reads latest.yml from the release.
async function checkAuto() {
  const current = app.getVersion()
  if (GITHUB_REPO === 'OWNER/REPO') return notConfigured(current)
  try {
    const result = await autoUpdater.checkForUpdates()
    const latest = result?.updateInfo?.version ?? current
    return { ok: true, mode: 'auto', current, latest, hasUpdate: Boolean(result?.isUpdateAvailable) }
  } catch {
    return { ok: false, current, error: 'Não foi possível verificar as atualizações.' }
  }
}

function send(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload)
}

export function registerUpdater() {
  if (AUTO_INSTALL && GITHUB_REPO !== 'OWNER/REPO') {
    autoUpdater.setFeedURL({ provider: 'github', owner: OWNER, repo: REPO })
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.on('download-progress', (p) => send('updater:progress', Math.round(p.percent)))
    autoUpdater.on('update-downloaded', () => send('updater:downloaded'))
    autoUpdater.on('error', () => send('updater:failed'))
  }

  ipcMain.handle('updater:check', () => (AUTO_INSTALL ? checkAuto() : checkManual()))

  // Starts the background download; progress/done/failed arrive as events.
  ipcMain.handle('updater:download', async () => {
    if (!AUTO_INSTALL) return false
    try {
      await autoUpdater.downloadUpdate()
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle('updater:install', () => {
    if (!AUTO_INSTALL) return false
    installing = true
    autoUpdater.quitAndInstall()
    return true
  })

  ipcMain.handle('updater:open', (_e, url) => {
    // Only ever open links that belong to this project's GitHub repository.
    if (typeof url !== 'string' || !url.startsWith(ALLOWED_PREFIX)) return false
    shell.openExternal(url)
    return true
  })
}
