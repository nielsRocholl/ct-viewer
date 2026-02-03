const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')

let mainWindow = null

function createWindow() {
  const isMac = process.platform === 'darwin'
  const iconPath = path.join(__dirname, '..', 'firefly-ct.ico')
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    icon: iconPath,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    ...(isMac && { trafficLightPosition: { x: 16, y: 24 } }),
    transparent: isMac,
    backgroundColor: isMac ? '#00000000' : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.loadURL('http://localhost:3000')

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

ipcMain.handle('show-folder-picker', async (_event, _payload) => {
  const win = BrowserWindow.getFocusedWindow()
  const result = await dialog.showOpenDialog(win || mainWindow, {
    properties: ['openDirectory'],
  })
  if (result.canceled || !result.filePaths.length) {
    return { path: null }
  }
  return { path: result.filePaths[0] }
})

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  app.quit()
})

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow()
  }
})
