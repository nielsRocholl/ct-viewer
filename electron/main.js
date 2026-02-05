const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const { spawn } = require('child_process')
const http = require('http')
const fs = require('fs')

let mainWindow = null
let backendProc = null
let staticServer = null

function waitForBackend(url, timeoutMs) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume()
        if (res.statusCode === 200) return resolve()
        if (Date.now() - start > timeoutMs) return reject(new Error('Backend not ready'))
        setTimeout(tick, 250)
      })
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) return reject(new Error('Backend not ready'))
        setTimeout(tick, 250)
      })
      req.end()
    }
    tick()
  })
}

function contentTypeForPath(p) {
  if (p.endsWith('.html')) return 'text/html'
  if (p.endsWith('.js')) return 'text/javascript'
  if (p.endsWith('.css')) return 'text/css'
  if (p.endsWith('.json')) return 'application/json'
  if (p.endsWith('.png')) return 'image/png'
  if (p.endsWith('.jpg') || p.endsWith('.jpeg')) return 'image/jpeg'
  if (p.endsWith('.svg')) return 'image/svg+xml'
  if (p.endsWith('.ico')) return 'image/x-icon'
  if (p.endsWith('.woff')) return 'font/woff'
  if (p.endsWith('.woff2')) return 'font/woff2'
  return 'application/octet-stream'
}

function startStaticServer(baseDir, startPort = 3000, maxAttempts = 10) {
  return new Promise((resolve, reject) => {
    let port = startPort
    let attempts = 0
    const tryListen = () => {
      const server = http.createServer((req, res) => {
        const rawUrl = req.url || '/'
        const cleanUrl = rawUrl.split('?')[0]
        let rel = cleanUrl
        if (rel.startsWith('/')) rel = rel.slice(1)
        let filePath = path.join(baseDir, rel)
        try {
          const stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null
          if (!stat) {
            res.statusCode = 404
            return res.end('Not found')
          }
          if (stat.isDirectory()) {
            filePath = path.join(filePath, 'index.html')
          }
          const data = fs.readFileSync(filePath)
          res.setHeader('Content-Type', contentTypeForPath(filePath))
          res.statusCode = 200
          res.end(data)
        } catch (err) {
          res.statusCode = 500
          res.end('Server error')
        }
      })
      server.on('error', (err) => {
        if (err.code === 'EADDRINUSE' && attempts < maxAttempts) {
          attempts += 1
          port += 1
          return tryListen()
        }
        reject(err)
      })
      server.listen(port, '127.0.0.1', () => resolve({ server, port }))
    }
    tryListen()
  })
}

function appendLog(stream, line) {
  try {
    stream.write(line)
  } catch (_) { }
}

async function createWindow() {
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

  if (app.isPackaged) {
    const backendPath = path.join(process.resourcesPath, 'ct-viewer-backend')
    const logPath = path.join(app.getPath('userData'), 'backend.log')
    const logStream = fs.createWriteStream(logPath, { flags: 'a' })
    backendProc = spawn(backendPath, [], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    if (backendProc.stdout) {
      backendProc.stdout.on('data', (buf) => appendLog(logStream, buf))
    }
    if (backendProc.stderr) {
      backendProc.stderr.on('data', (buf) => appendLog(logStream, buf))
    }
    backendProc.on('exit', () => {
      backendProc = null
    })
    try {
      await waitForBackend('http://127.0.0.1:8000/health', 20000)
    } catch (err) {
      dialog.showErrorBox(
        'Backend Error',
        'Backend failed to start. See backend.log in the app data folder.'
      )
    }
    const outDir = path.join(app.getAppPath(), 'frontend', 'out')
    const { server, port } = await startStaticServer(outDir)
    staticServer = server
    await mainWindow.loadURL(`http://127.0.0.1:${port}`)
  } else {
    await mainWindow.loadURL('http://localhost:3000')
  }

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
  if (staticServer) {
    staticServer.close()
    staticServer = null
  }
  if (backendProc) {
    backendProc.kill()
    backendProc = null
  }
  app.quit()
})

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow()
  }
})
