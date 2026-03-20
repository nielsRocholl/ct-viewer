const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  showFolderPicker: (payload) =>
    ipcRenderer.invoke('show-folder-picker', payload).then((res) => res.path),
  onSplashProgress: (cb) => {
    const fn = (_e, data) => cb(data)
    ipcRenderer.on('splash-progress', fn)
    return () => ipcRenderer.removeListener('splash-progress', fn)
  },
})
