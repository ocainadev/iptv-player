import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell } from 'electron'
import { join } from 'path'
import { isInstalling, registerUpdater } from './updater'

const isDev = !app.isPackaged && process.env.ELECTRON_RENDERER_URL

// The app used to be called "IPTV Player". Electron derives the data folder from the app name, so
// keep the old folder: profiles, progress and settings stay where they were after the rename.
app.setPath('userData', join(app.getPath('appData'), 'IPTV Player'))

// Set by the renderer while a video plays or an update downloads: only then closing asks first.
let busy = false

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
    if (isInstalling() || !busy) return
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ['Sair', 'Cancelar'],
      defaultId: 1,
      title: 'Confirmar',
      message: 'Deseja fechar o app?',
      detail: 'Há um vídeo em reprodução ou uma atualização sendo baixada.'
    })
    if (choice === 1) e.preventDefault()
  })

  if (isDev) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

function buildMenu() {
  const mac = process.platform === 'darwin'
  const template = [
    mac
      ? {
          label: app.name,
          submenu: [
            { role: 'about', label: `Sobre o ${app.name}` },
            { type: 'separator' },
            { role: 'services', label: 'Serviços' },
            { type: 'separator' },
            { role: 'hide', label: `Ocultar ${app.name}` },
            { role: 'hideOthers', label: 'Ocultar outros' },
            { role: 'unhide', label: 'Mostrar tudo' },
            { type: 'separator' },
            { role: 'quit', label: `Sair do ${app.name}` }
          ]
        }
      : { label: 'Arquivo', submenu: [{ role: 'quit', label: 'Sair' }] },
    {
      label: 'Editar',
      submenu: [
        { role: 'undo', label: 'Desfazer' },
        { role: 'redo', label: 'Refazer' },
        { type: 'separator' },
        { role: 'cut', label: 'Recortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Colar' },
        { role: 'selectAll', label: 'Selecionar tudo' }
      ]
    },
    {
      label: 'Visualizar',
      submenu: [
        { role: 'reload', label: 'Recarregar' },
        { role: 'togglefullscreen', label: 'Tela cheia' },
        { role: 'toggleDevTools', label: 'Ferramentas do desenvolvedor' }
      ]
    },
    {
      label: 'Janela',
      submenu: [
        { role: 'minimize', label: 'Minimizar' },
        ...(mac ? [{ role: 'zoom', label: 'Ampliar' }, { type: 'separator' }, { role: 'front', label: 'Trazer tudo para a frente' }] : []),
        { role: 'close', label: 'Fechar' }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(() => {
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.on('app:busy', (_e, value) => {
    busy = Boolean(value)
  })
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
