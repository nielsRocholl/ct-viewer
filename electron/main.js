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

function readLastLines(filePath, maxLines, maxBytes = 2048) {
  try {
    if (!fs.existsSync(filePath)) return ''
    const buf = Buffer.alloc(maxBytes)
    const fd = fs.openSync(filePath, 'r')
    const stat = fs.fstatSync(fd)
    const size = stat.size
    const toRead = Math.min(size, maxBytes)
    const start = size - toRead
    fs.readSync(fd, buf, 0, toRead, start)
    fs.closeSync(fd)
    const tail = buf.slice(0, toRead).toString('utf8').replace(/\r\n/g, '\n').split('\n')
    const lines = tail.slice(-maxLines).filter(Boolean)
    return lines.join('\n').slice(-1500)
  } catch (_) {
    return ''
  }
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
    show: false,
    transparent: false,
    backgroundColor: '#0b0b0b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  mainWindow.once('ready-to-show', () => {
    if (!mainWindow) return
    mainWindow.show()
  })

  const loadSplash = async (message) => {
    const msg = message || 'Starting MangoCT…'
    const html = `<!doctype html><html><head><meta charset="utf-8"/><style>
      html,body{height:100%;margin:0;background:#0b0b0b;color:#e5e7eb;font:14px -apple-system,system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;display:flex;align-items:center;justify-content:center;}
      .box{display:flex;gap:10px;align-items:center;padding:12px 16px;border:1px solid #1f2937;border-radius:10px;background:#111827}
      .dot{width:8px;height:8px;border-radius:50%;background:#22c55e;animation:pulse 1.2s ease-in-out infinite;}
      @keyframes pulse{0%,100%{opacity:.4}50%{opacity:1}}
    </style></head><body><div class="box"><div class="dot"></div><div>${msg}</div></div></body></html>`
    await mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  }

  if (app.isPackaged) {
    await loadSplash()
    const backendPath = path.join(process.resourcesPath, 'ct-viewer-backend')
    const logPath = path.join(app.getPath('userData'), 'backend.log')
    const logStream = fs.createWriteStream(logPath, { flags: 'a' })
    let backendExitedBeforeReady = false
    let exitCode = null
    let exitSignal = null
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
    backendProc.on('exit', (code, signal) => {
      backendExitedBeforeReady = true
      exitCode = code
      exitSignal = signal
      backendProc = null
    })
    try {
      await waitForBackend('http://127.0.0.1:8000/health', 20000)
    } catch (err) {
      if (backendProc) {
        backendProc.kill()
        backendProc = null
      }
      logStream.end()
      const logSnippet = readLastLines(logPath, 15)
      const workaround = 'If this app was downloaded or copied, macOS may block the backend. In Terminal run:\n  xattr -cr "/Applications/MangoCT.app"'
      const msg = [
        `Log: ${logPath}`,
        logSnippet ? `\nLast log lines:\n${logSnippet}` : '',
        backendExitedBeforeReady && (exitCode != null || exitSignal) ? `\nBackend exited: code=${exitCode} signal=${exitSignal}` : '',
        `\n\n${workaround}`,
      ].join('')
      await loadSplash('Backend failed to start. See backend.log in the app data folder.')
      dialog.showErrorBox('Backend Error', msg)
    }
    const outDir = path.join(app.getAppPath(), 'frontend', 'out')
    const { server, port } = await startStaticServer(outDir)
    staticServer = server
    await mainWindow.loadURL(`http://127.0.0.1:${port}`)
  } else {
    await loadSplash('Waiting for dev server…')
    try {
      await mainWindow.loadURL('http://localhost:3000')
    } catch (err) {
      await loadSplash('Dev server not running. Start it with: npm --prefix frontend run dev')
    }
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
