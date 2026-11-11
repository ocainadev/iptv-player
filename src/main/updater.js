import { app, BrowserWindow, ipcMain, shell } from 'electron'
import electronUpdater from 'electron-updater'
import { spawn } from 'node:child_process'
import { createWriteStream, accessSync, constants, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const { autoUpdater } = electronUpdater

// "owner/repo" of the GitHub repository that hosts the releases.
// Keep in sync with `publish` in electron-builder.yml.
const GITHUB_REPO = 'ocainadev/iptv-player'

const [OWNER, REPO] = GITHUB_REPO.split('/')
// IPTV_UPDATE_API points the check at a local mock of the GitHub response; it only exists to
// test the update flow. Links are then allowed on that server instead of GitHub.
const TEST_API = process.env.IPTV_UPDATE_API
const API_URL = TEST_API || `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`
const ALLOWED_PREFIX = TEST_API ? new URL(TEST_API).origin + '/' : `https://github.com/${GITHUB_REPO}/`

// In-app install (electron-updater) works for the installed Windows build and for the Linux
// AppImage. The portable .exe has no install dir to replace, a .deb is owned by the package
// manager, and macOS needs a paid signature for it, so those use another path.
const WIN_INSTALLED = process.platform === 'win32' && app.isPackaged && !process.env.PORTABLE_EXECUTABLE_DIR
const LINUX_APPIMAGE = process.platform === 'linux' && app.isPackaged && Boolean(process.env.APPIMAGE)
const AUTO_INSTALL = WIN_INSTALLED || LINUX_APPIMAGE

// macOS cannot use electron-updater without a paid signature, so the app downloads the .dmg
// itself and swaps the .app bundle (see installMac). Files downloaded this way carry no
// quarantine flag, so Gatekeeper does not ask again.
const MAC_SELF_INSTALL = process.platform === 'darwin' && app.isPackaged

let installing = false
let downloadedFile = null
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
  } else if (process.platform === 'linux') {
    // electron-builder names: "IPTV-Player-<ver>-x86_64.AppImage", "...-arm64.AppImage",
    // "...-amd64.deb", "...-arm64.deb". A .deb install is updated by hand with the new .deb.
    const arch = process.arch === 'arm64' ? /arm64|aarch64/ : /x86_64|amd64|x64/
    const ext = app.isPackaged && !process.env.APPIMAGE ? '.deb' : '.appimage'
    found = names.find((a) => a.name.endsWith(ext) && arch.test(a.name))
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
      mode: MAC_SELF_INSTALL && assetUrl ? 'mac' : 'manual',
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

// Downloads the new .dmg to a temp folder, reporting progress to the window.
async function downloadMac(url) {
  const dir = join(tmpdir(), 'iptv-player-update')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'update.dmg')
  // A download that stops sending for 30 s is abandoned (the banner then offers a retry).
  const controller = new AbortController()
  let idle
  const armIdleTimer = () => {
    clearTimeout(idle)
    idle = setTimeout(() => controller.abort(), 30000)
  }
  armIdleTimer()
  try {
    return await fetchToFile(url, file, controller.signal, armIdleTimer)
  } finally {
    clearTimeout(idle)
  }
}

async function fetchToFile(url, file, signal, onActivity) {
  const res = await fetch(url, { headers: { 'User-Agent': 'iptv-player-updater' }, signal })
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length')) || 0
  let received = 0
  let lastPercent = -1
  // Counting happens inside the pipeline itself: one consumer, so backpressure stays correct.
  await pipeline(
    Readable.fromWeb(res.body),
    async function* (chunks) {
      for await (const chunk of chunks) {
        onActivity()
        received += chunk.length
        const percent = total ? Math.floor((received / total) * 100) : 0
        if (percent !== lastPercent) {
          lastPercent = percent
          send('updater:progress', percent)
        }
        yield chunk
      }
    },
    createWriteStream(file + '.part'),
    { signal }
  )
  if (total && received !== total) throw new Error('incomplete download')
  renameSync(file + '.part', file)
  return file
}

// Swaps the running .app for the one inside the downloaded .dmg. A detached shell script does
// it after this process exits (a running app cannot replace itself), then reopens the app.
function installMac() {
  const target = app.getPath('exe').replace(/\/Contents\/MacOS\/[^/]*$/, '')
  try {
    if (!downloadedFile || !target.endsWith('.app')) throw new Error('nothing to install')
    accessSync(dirname(target), constants.W_OK)
  } catch {
    // Not writable (or unexpected layout): hand the .dmg to the user instead.
    if (downloadedFile) shell.openPath(downloadedFile)
    return { ok: false, message: 'Abri o instalador: arraste o app para a pasta Aplicativos.' }
  }
  const script = join(dirname(downloadedFile), 'install.sh')
  writeFileSync(
    script,
    `#!/bin/sh
while kill -0 "$PID" 2>/dev/null; do sleep 0.3; done
MNT=$(mktemp -d /tmp/iptv-update-mnt.XXXXXX)
if hdiutil attach -nobrowse -noverify -quiet -mountpoint "$MNT" "$DMG"; then
  SRC=$(ls -d "$MNT"/*.app | head -1)
  rm -rf "$TARGET.new" "$TARGET.old"
  if [ -n "$SRC" ] && ditto "$SRC" "$TARGET.new"; then
    mv "$TARGET" "$TARGET.old" && mv "$TARGET.new" "$TARGET" && rm -rf "$TARGET.old"
  fi
  rm -rf "$TARGET.new"
  hdiutil detach -quiet "$MNT"
fi
rmdir "$MNT" 2>/dev/null
xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null
rm -f "$DMG"
open "$TARGET"
`,
    { mode: 0o700 }
  )
  spawn('/bin/sh', [script], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, PID: String(process.pid), DMG: downloadedFile, TARGET: target }
  }).unref()
  installing = true
  app.quit()
  return { ok: true }
}

export function registerUpdater() {
  if (AUTO_INSTALL && GITHUB_REPO !== 'OWNER/REPO') {
    autoUpdater.setFeedURL({ provider: 'github', owner: OWNER, repo: REPO })
    autoUpdater.autoDownload = false
    // A downloaded update also installs by itself the next time the app is closed.
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.on('download-progress', (p) => send('updater:progress', Math.round(p.percent)))
    autoUpdater.on('update-downloaded', () => send('updater:downloaded'))
    autoUpdater.on('error', () => send('updater:failed'))
  }

  ipcMain.handle('updater:check', () => (AUTO_INSTALL ? checkAuto() : checkManual()))

  // Starts the background download; progress/done/failed arrive as events.
  ipcMain.handle('updater:download', async (_e, url) => {
    try {
      if (AUTO_INSTALL) {
        await autoUpdater.downloadUpdate()
        return true
      }
      if (MAC_SELF_INSTALL && typeof url === 'string' && url.startsWith(ALLOWED_PREFIX)) {
        downloadedFile = await downloadMac(url)
        send('updater:downloaded')
        return true
      }
    } catch {
      send('updater:failed')
    }
    return false
  })

  ipcMain.handle('updater:install', () => {
    if (AUTO_INSTALL) {
      installing = true
      autoUpdater.quitAndInstall()
      return { ok: true }
    }
    if (MAC_SELF_INSTALL) return installMac()
    return { ok: false }
  })

  ipcMain.handle('updater:open', (_e, url) => {
    // Only ever open links that belong to this project's GitHub repository.
    if (typeof url !== 'string' || !url.startsWith(ALLOWED_PREFIX)) return false
    shell.openExternal(url)
    return true
  })
}
