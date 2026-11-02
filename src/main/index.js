import { app, BrowserWindow, dialog, Menu, session, shell } from 'electron'
import { join } from 'path'
import { isInstalling, registerUpdater } from './updater'

const isDev = !app.isPackaged && process.env.ELECTRON_RENDERER_URL

// IPTV servers rarely send CORS headers. The renderer fetches the Xtream API
// and HLS segments directly, so add permissive CORS headers to every response.
function allowCrossOrigin() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders }
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase().startsWith('access-control-')) delete headers[key]
    }
    headers['Access-Control-Allow-Origin'] = ['*']
    headers['Access-Control-Allow-Headers'] = ['*']
    headers['Access-Control-Allow-Methods'] = ['GET, HEAD, OPTIONS']
    callback({ responseHeaders: headers })
  })
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.on('ready-to-show', () => win.show())

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  // The renderer only ever shows the bundled app; never navigate it elsewhere.
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault()
  })

  win.on('close', (e) => {
    if (isInstalling()) return
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ['Sair', 'Cancelar'],
      defaultId: 1,
      title: 'Confirmar',
      message: 'Deseja fechar o app?'
    })
    if (choice === 1) e.preventDefault()
  })

  if (isDev) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

function buildMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : [{ role: 'fileMenu' }]),
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, { role: 'toggleDevTools' }]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(() => {
  allowCrossOrigin()
  registerUpdater()
  buildMenu()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
